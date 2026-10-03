import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// LLM giả tương thích OpenAI (stream). Mỗi phần tử trong `script` là phản hồi cho một lượt gọi.
export type MockTurn = { text?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> };

export async function startMockLlm(script: MockTurn[]): Promise<{ url: string; requests: unknown[]; close: () => Promise<void> }> {
  const requests: unknown[] = [];
  let turn = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const current = script[Math.min(turn++, script.length - 1)];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta: unknown) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      // Tách chữ thành nhiều chunk để thử luồng và ghép delta
      for (const piece of (current.text ?? '').match(/.{1,12}/gs) ?? []) send({ content: piece });
      (current.toolCalls ?? []).forEach((call, i) => {
        // Kiểu OpenAI: tên và đối số đến rời rạc theo index
        send({ tool_calls: [{ index: i, id: `call_${turn}_${i}`, type: 'function', function: { name: call.name, arguments: '' } }] });
        const args = JSON.stringify(call.args);
        send({ tool_calls: [{ index: i, function: { arguments: args.slice(0, 5) } }] });
        send({ tool_calls: [{ index: i, function: { arguments: args.slice(5) } }] });
      });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) };
}
