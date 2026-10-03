import { redactPii } from '@wealthcompass/core';
import type { ChatEvent, ChatRequest } from '@wealthcompass/contracts';
import type { Principal } from './auth.js';
import type { ServerConfig } from './config.js';
import type { FeatureStore } from './feature-store.js';
import { classifyInput } from './guardrails.js';
import { LlmError, streamChat, type LlmMessage, type ToolSpec } from './llm.js';
import type { DomainPack } from './pack.js';

const MAX_ROUNDS = 4;

const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'search_features',
      description: 'Tìm tính năng/màn hình trên web theo câu hỏi của người dùng. Dùng khi kết quả tra cứu ban đầu chưa đủ.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'offer_tour',
      description: 'Hiện nút "Dẫn tôi đi" cho một tour hướng dẫn có sẵn. Tour chỉ chạy khi người dùng bấm nút.',
      parameters: { type: 'object', properties: { tour_id: { type: 'string' } }, required: ['tour_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'offer_navigate',
      description: 'Hiện nút mở thẳng một màn hình, dùng khi tính năng không có tour.',
      parameters: { type: 'object', properties: { feature_id: { type: 'string' } }, required: ['feature_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'handoff_support',
      description: 'Gợi ý liên hệ chăm sóc khách hàng khi không tìm thấy tính năng phù hợp.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export interface AgentDeps {
  config: ServerConfig;
  store: FeatureStore;
  pack: DomainPack;
  log: (entry: Record<string, unknown>) => void;
}

// Chế độ dự phòng khi LLM không khả dụng (hết hạn mức, mất mạng): vẫn trả lời được từ bản đồ tính năng,
// chỉ kém tự nhiên hơn. Hạ cấp thay vì báo lỗi cứng (plan mục 6.4). Có ghi chú để không đánh lạc hướng người dùng.
function* fallbackReply(prefetch: ReturnType<FeatureStore['search']>, offered: Set<string>): Generator<ChatEvent> {
  const top = prefetch.results[0];
  // `restricted` chỉ có khi tính năng khớp nhất bị khóa quyền, nên ưu tiên giải thích thay vì chỉ sang màn hình kém liên quan
  if (prefetch.restricted) {
    yield { type: 'text', delta: `**${prefetch.restricted.title}** cần quyền ${prefetch.restricted.requires.join(', ')} mà tài khoản hiện tại chưa có. Bạn liên hệ chăm sóc khách hàng để được hỗ trợ mở quyền nhé.` };
    return;
  }
  if (!top) {
    yield { type: 'text', delta: 'Mình chưa tìm thấy tính năng phù hợp. Bạn thử diễn đạt khác nhé.' };
    yield { type: 'handoff', message: 'Nếu vẫn chưa tìm được, bạn có thể liên hệ chăm sóc khách hàng qua mục Trợ giúp để được hỗ trợ trực tiếp.' };
    return;
  }
  const lines = [`**${top.title}**`, `Đường đi: ${top.menuPath.join(' › ')}`, top.description];
  const tour = top.tours[0];
  if (tour) {
    lines.push('', 'Các bước:', ...tour.steps.map((t, i) => `${i + 1}. ${t}`), '', 'Bấm nút bên dưới để tôi dẫn bạn đi từng bước.');
  }
  lines.push('', '(Chế độ dự phòng: trợ lý AI tạm không khả dụng, nội dung lấy trực tiếp từ bản đồ tính năng.)');
  yield { type: 'text', delta: lines.join('\n') };
  if (tour) {
    offered.add(tour.id);
    yield { type: 'offer_tour', tourId: tour.id, label: `Dẫn tôi đi: ${tour.title}` };
  } else if (!top.route.includes(':')) {
    offered.add(top.id);
    yield { type: 'offer_navigate', route: top.route, label: `Mở: ${top.title}` };
  }
}

export async function* runAgent(
  deps: AgentDeps,
  principal: Principal,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const { store, pack, config, log } = deps;
  const startedAt = Date.now();
  const message = redactPii(request.message).text;
  const toolsUsed: string[] = [];

  // Lớp 1: chặn trước khi gọi LLM
  const verdict = classifyInput(message, pack);
  if (verdict.blocked) {
    log({ event: 'chat', user: principal.id, q: message, outcome: 'refused', topic: verdict.topic });
    yield { type: 'refusal', message: verdict.message ?? '' };
    yield { type: 'done' };
    return;
  }

  // Quyền lấy từ token đã xác minh, KHÔNG tin danh sách quyền client gửi lên
  const capabilities = principal.roles;
  const prefetch = store.search(message, capabilities);

  const context = [
    `Màn hình hiện tại của người dùng: ${request.context.route}`,
    `Phần tử có tourId đang hiện: ${request.context.visibleTargets.join(', ') || '(không có)'}`,
    `Quyền tài khoản: ${capabilities.join(', ') || '(không có)'}`,
  ].join('\n');
  const system = `${pack.systemPrompt}\n\nNGỮ CẢNH\n${context}\n\nKẾT QUẢ TRA CỨU BAN ĐẦU (cho câu hỏi hiện tại)\n${JSON.stringify(prefetch)}`;

  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    ...request.history.slice(-8).map((m) => ({ role: m.role, content: redactPii(m.content).text }) as LlmMessage),
    { role: 'user', content: message },
  ];

  const offered = new Set<string>();
  let anyText = false;
  let handedOff = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let text = '';
      let calls: Array<import('./llm.js').ToolCall> = [];

      for await (const chunk of streamChat(config.llm, { messages, tools: TOOLS, signal })) {
        if (chunk.type === 'text') {
          text += chunk.delta;
          anyText = true;
          yield { type: 'text', delta: chunk.delta };
        } else {
          calls = chunk.calls;
        }
      }
      if (!calls.length) break;
      // Đã viết câu trả lời cùng lượt với các lệnh chỉ hiện nút: không gọi thêm lượt nữa, tránh lặp câu
      const onlyOffers = calls.every((c) => ['offer_tour', 'offer_navigate', 'handoff_support'].includes(c.function.name));
      const finishAfterTools = onlyOffers && text.trim().length > 0;

      messages.push({ role: 'assistant', content: text || null, tool_calls: calls });
      for (const call of calls) {
        toolsUsed.push(call.function.name);
        let args: Record<string, string> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          // Đối số hỏng: coi như rỗng và để validate bên dưới từ chối
        }
        let result: unknown;

        switch (call.function.name) {
          case 'search_features':
            result = store.search(String(args['query'] ?? message), capabilities);
            break;

          case 'offer_tour': {
            // Whitelist: chỉ tour có trong Feature Map và người dùng đủ quyền vào tính năng chứa nó
            const tour = store.getTour(String(args['tour_id']));
            const owner = tour && store.featureMap.features.find((f) => f.tourIds.includes(tour.id));
            const permitted = owner?.access.requires.every((r) => capabilities.includes(r)) ?? false;
            if (tour && permitted && !offered.has(tour.id)) {
              offered.add(tour.id);
              yield { type: 'offer_tour', tourId: tour.id, label: `Dẫn tôi đi: ${tour.title}` };
              result = { ok: true, note: 'Đã hiện nút. Mời người dùng bấm nút để bắt đầu.' };
            } else {
              result = { ok: false, error: 'tour không tồn tại hoặc người dùng không có quyền' };
            }
            break;
          }

          case 'offer_navigate': {
            const feature = store.getFeature(String(args['feature_id']));
            const permitted = feature?.access.requires.every((r) => capabilities.includes(r)) ?? false;
            if (feature && permitted && !feature.route.pattern.includes(':') && !offered.has(feature.id)) {
              offered.add(feature.id);
              yield { type: 'offer_navigate', route: feature.route.pattern, label: `Mở: ${feature.title}` };
              result = { ok: true };
            } else {
              result = { ok: false, error: 'màn hình không tồn tại, cần tham số, hoặc không có quyền' };
            }
            break;
          }

          case 'handoff_support':
            handedOff = true;
            result = { ok: true };
            break;

          default:
            result = { ok: false, error: 'công cụ không tồn tại' };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      if (finishAfterTools) break;
    }

    if (!anyText) {
      yield { type: 'text', delta: 'Mình chưa tìm thấy tính năng phù hợp. Bạn thử diễn đạt khác, hoặc liên hệ chăm sóc khách hàng để được hỗ trợ nhé.' };
    }
    if (handedOff) {
      yield { type: 'handoff', message: 'Nếu vẫn chưa tìm được, bạn có thể liên hệ chăm sóc khách hàng qua mục Trợ giúp để được hỗ trợ trực tiếp.' };
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    const detail = error instanceof LlmError ? error.message : 'lỗi không xác định';
    log({ event: 'chat_error', user: principal.id, detail, fallback: !anyText });
    if (anyText) {
      yield { type: 'error', message: 'Trợ lý gặp sự cố giữa chừng, bạn thử hỏi lại nhé.' };
    } else {
      yield* fallbackReply(prefetch, offered);
    }
  }

  log({
    event: 'chat',
    user: principal.id,
    q: message,
    route: request.context.route,
    hits: prefetch.results.map((r) => r.id),
    tools: toolsUsed,
    offered: [...offered],
    ms: Date.now() - startedAt,
  });
  yield { type: 'done' };
}
