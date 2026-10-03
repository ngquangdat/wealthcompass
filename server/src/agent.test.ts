import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ChatEvent, ChatRequest } from '@wealthcompass/contracts';
import { runAgent, type AgentDeps } from './agent.js';
import { loadConfig } from './config.js';
import { FeatureStore } from './feature-store.js';
import { loadPack } from './pack.js';
import { startMockLlm, type MockTurn } from './test/mock-llm.js';

const base = loadConfig();
const pack = loadPack(base.packDir);
const store = new FeatureStore(base.featureMapPath, pack);

const request = (message: string): ChatRequest => ({
  message,
  history: [],
  context: { route: '/home', visibleTargets: [], locale: 'vi', capabilities: [] },
});

async function run(script: MockTurn[], message: string, roles = ['bond_account']) {
  const llm = await startMockLlm(script);
  const deps: AgentDeps = { config: { ...base, llm: { baseUrl: llm.url, apiKey: 'test', model: 'mock' } }, store, pack, log: () => undefined };
  const events: ChatEvent[] = [];
  for await (const e of runAgent(deps, { id: 't', name: 't', roles }, request(message), new AbortController().signal)) events.push(e);
  await llm.close();
  return { events, llm };
}

const text = (events: ChatEvent[]) => events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('');

test('hỏi bán trái phiếu: LLM gọi offer_tour, server phát nút tour', async () => {
  const { events } = await run(
    [{ toolCalls: [{ name: 'offer_tour', args: { tour_id: 'sell-bond' } }] }, { text: 'Vào tab **Tài sản**, bấm CHỌN BÁN. Bấm nút bên dưới nhé.' }],
    'Bán trái phiếu ở đâu?',
  );
  const offer = events.find((e) => e.type === 'offer_tour');
  assert.deepEqual(offer, { type: 'offer_tour', tourId: 'sell-bond', label: 'Dẫn tôi đi: Bán trái phiếu trên iConnect' });
  assert.match(text(events), /CHỌN BÁN/);
  assert.equal(events.at(-1)?.type, 'done');
});

test('whitelist: tour_id bịa ra bị từ chối, không có nút', async () => {
  const { events } = await run([{ toolCalls: [{ name: 'offer_tour', args: { tour_id: 'hack-tour' } }] }, { text: 'ok' }], 'bán trái phiếu');
  assert.equal(events.some((e) => e.type === 'offer_tour'), false);
});

test('thiếu quyền trái phiếu: không phát nút tour dù LLM gọi', async () => {
  const { events } = await run([{ toolCalls: [{ name: 'offer_tour', args: { tour_id: 'sell-bond' } }] }, { text: 'x' }], 'bán trái phiếu', ['stock_account']);
  assert.equal(events.some((e) => e.type === 'offer_tour'), false);
});

test('câu hỏi tư vấn đầu tư bị chặn trước khi gọi LLM', async () => {
  const { events, llm } = await run([{ text: 'không được gọi' }], 'Có nên mua trái phiếu VHM12607 không?');
  assert.equal(events[0].type, 'refusal');
  assert.equal(llm.requests.length, 0);
});

test('"đặt lệnh bán ở đâu" không bị chặn nhầm là nhờ đặt hộ', async () => {
  const { events, llm } = await run([{ text: 'Vào tab Tài sản.' }], 'Đặt lệnh bán trái phiếu ở đâu?');
  assert.notEqual(events[0].type, 'refusal');
  assert.equal(llm.requests.length, 1);
});

test('nhờ đặt lệnh hộ bị từ chối', async () => {
  const { events } = await run([{ text: 'x' }], 'Đặt giúp tôi lệnh bán trái phiếu');
  assert.equal(events[0].type, 'refusal');
});

test('PII bị che trước khi gửi LLM', async () => {
  const { llm } = await run([{ text: 'ok' }], 'Tài khoản 105C123456 số 0912345678 bán trái phiếu ở đâu');
  const sent = JSON.stringify(llm.requests[0]);
  assert.equal(sent.includes('105C123456'), false);
  assert.equal(sent.includes('0912345678'), false);
});

test('LLM lỗi: chuyển sang trả lời dự phòng từ bản đồ tính năng, vẫn có nút tour', async () => {
  const deps: AgentDeps = { config: { ...base, llm: { baseUrl: 'http://127.0.0.1:1', apiKey: 'x', model: 'm' } }, store, pack, log: () => undefined };
  const events: ChatEvent[] = [];
  for await (const e of runAgent(deps, { id: 't', name: 't', roles: ['bond_account'] }, request('bán trái phiếu ở đâu'), new AbortController().signal)) events.push(e);
  assert.match(text(events), /Tài sản trái phiếu/);
  assert.equal(events.some((e) => e.type === 'offer_tour'), true);
  assert.match(text(events), /dự phòng/);
});

test('dự phòng: tài khoản thiếu quyền trái phiếu được giải thích, không bị dẫn sang màn hình khác', async () => {
  const deps: AgentDeps = { config: { ...base, llm: { baseUrl: 'http://127.0.0.1:1', apiKey: 'x', model: 'm' } }, store, pack, log: () => undefined };
  const events: ChatEvent[] = [];
  for await (const e of runAgent(deps, { id: 't', name: 't', roles: ['stock_account'] }, request('bán trái phiếu ở đâu'), new AbortController().signal)) events.push(e);
  assert.match(text(events), /cần quyền bond_account/);
  assert.equal(events.some((e) => e.type === 'offer_tour' || e.type === 'offer_navigate'), false);
});
