// Kiểm tra nhanh chất lượng tìm kiếm trên Feature Map thật (chạy: npx tsx src/search-check.ts)
import { FeatureStore } from './feature-store.js';
import { loadConfig } from './config.js';
import { loadPack } from './pack.js';

const config = loadConfig();
const store = new FeatureStore(config.featureMapPath, loadPack(config.packDir));
const caps = ['stock_account', 'bond_account'];
const cases: Array<[string, string]> = [
  ['bán trái phiếu ở đâu?', 'iconnect.assets'],
  ['ban trai phieu', 'iconnect.assets'],
  ['cách bán lại trái phiếu trước hạn', 'iconnect.assets'],
  ['nộp tiền vào tài khoản', 'money.deposit'],
  ['xem bảng giá trái phiếu', 'iconnect.price-board'],
  ['mua trái phiếu', 'iconnect.price-board'],
  ['xem lãi lỗ', 'iconnect.pnl'],
  ['hủy lệnh đã đặt', 'iconnect.orders'],
  ['rút tiền về ngân hàng', 'money.transfer'],
  ['thời tiết hôm nay thế nào', ''],
];
let pass = 0;
for (const [q, expected] of cases) {
  const r = store.search(q, caps);
  const top = r.results[0]?.id ?? '';
  const ok = top === expected;
  if (ok) pass++;
  console.log(`${ok ? 'OK ' : 'LỖI'} "${q}" -> ${top || '(không có)'} ${r.results.map((x) => `${x.id}:${x.score}`).join(' ')}`);
}
console.log(`\n${pass}/${cases.length}`);
const noBond = store.search('bán trái phiếu ở đâu', ['stock_account']);
console.log('Thiếu quyền:', noBond.results.map((x) => x.id), 'restricted=', noBond.restricted);
