import type { ChatEvent } from '@wealthcompass/contracts';

// Đọc luồng SSE từ fetch (POST nên không dùng EventSource được).
// Mỗi sự kiện là một dòng `data: {json}` cách nhau bởi dòng trống.
export async function* readChatEvents(response: Response): AsyncGenerator<ChatEvent> {
  if (!response.body) throw new Error('Phản hồi không có body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!data) continue;
      try {
        yield JSON.parse(data) as ChatEvent;
      } catch {
        // Bỏ qua khối hỏng thay vì làm đứt cả luồng
      }
    }
  }
}
