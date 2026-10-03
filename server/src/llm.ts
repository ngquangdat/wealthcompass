import type { ServerConfig } from './config.js';

// Client tối thiểu cho endpoint tương thích OpenAI (Gemini, DeepSeek, vLLM/Ollama on-prem đều dùng được).

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  // Gemini 3 yêu cầu gửi lại nguyên phần này ở lượt sau; giữ nguyên, không đọc
  extra_content?: unknown;
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type LlmChunk = { type: 'text'; delta: string } | { type: 'tool_calls'; calls: ToolCall[] };

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function* streamChat(
  config: ServerConfig['llm'],
  params: { messages: LlmMessage[]; tools: ToolSpec[]; signal?: AbortSignal },
): AsyncGenerator<LlmChunk> {
  if (!config.apiKey) throw new LlmError('Chưa cấu hình khóa LLM (COMPASS_LLM_API_KEY hoặc GOOGLE_API_KEY)');

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: params.messages,
      tools: params.tools,
      tool_choice: 'auto',
      temperature: 0.2,
      stream: true,
    }),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    // Không đưa nguyên body lỗi ra ngoài vì có thể chứa thông tin cấu hình
    throw new LlmError(`LLM trả lỗi ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls: ToolCall[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;

      let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<Partial<ToolCall> & { index?: number }> } }> };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) yield { type: 'text', delta: delta.content };
      for (const part of delta.tool_calls ?? []) {
        // Gemini gửi cả lời gọi trong một chunk và có thể thiếu index; OpenAI gửi tên/đối số rời rạc theo index
        const index = part.index ?? (part.id ? calls.length : Math.max(0, calls.length - 1));
        const current = (calls[index] ??= { id: part.id ?? `call_${index}`, type: 'function', function: { name: '', arguments: '' } });
        if (part.id) current.id = part.id;
        if (part.function?.name) current.function.name += part.function.name;
        if (part.function?.arguments) current.function.arguments += part.function.arguments;
        if (part.extra_content) current.extra_content = part.extra_content;
      }
    }
  }
  const finished = calls.filter(Boolean);
  if (finished.length) yield { type: 'tool_calls', calls: finished };
}
