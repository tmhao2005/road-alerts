// Paste a coordinate from Google Maps, get the speed limit and every reason behind it.
//
//   npm run check -- "10.7769, 106.7009"
//   npm run check -- "10.7769, 106.7009" --xe xe_mo_to
//   npm run check -- "<google maps url>" --tat-ca
import { readFileSync, existsSync } from 'node:fs';
import { parseCoordinate } from '../src/geo.js';
import { buildIndex, matchRoad, roadFacts, placeFacts, roadLabel } from '../src/lookup.js';
import { guessZone } from '../src/zone.js';
import { statutoryLimit, withSign, VEHICLES } from '../src/limit.js';

const INDEX = 'data/hcm-index.json';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const text = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--xe').join(' ');

const p = parseCoordinate(text);
if (!p) {
  console.error('Không đọc được toạ độ. Dán dạng "10.7769, 106.7009" hoặc cả đường link Google Maps.');
  process.exit(1);
}
if (!existsSync(INDEX)) {
  console.error(`Chưa có ${INDEX}. Chạy: npm run prep`);
  process.exit(1);
}

const index = buildIndex(JSON.parse(readFileSync(INDEX, 'utf8')));
if (index.bbox && !(p[0] >= index.bbox[0] && p[0] <= index.bbox[2] && p[1] >= index.bbox[1] && p[1] <= index.bbox[3])) {
  console.error('Toạ độ nằm ngoài vùng dữ liệu TP.HCM đã chuẩn bị.');
  process.exit(1);
}

const m = matchRoad(index, p);
if (!m) {
  console.log('Không có con đường nào trong vòng 35 m. Thử chấm sát giữa lòng đường hơn.');
  process.exit(0);
}

const road = roadFacts(m.road);
const place = placeFacts(index, p);
const zone = guessZone({ highway: road.highway, ...place });

const conf = { cao: 'chắc', trung_binh: 'khá chắc', thap: 'không chắc' };
const tierLabel = { bien_bao: 'Biển báo (theo bản đồ)', theo_luat: 'Theo luật định', khong_ro: 'Chưa đủ dữ liệu' };

function limitFor(vehicle) {
  const s = statutoryLimit(vehicle, { ...road, inside: zone.inside });
  return withSign(vehicle, s, road.sign);
}

const name = [m.road.name, m.road.ref].filter(Boolean).join(' · ') || '(không tên)';
const lanes = road.lanes ? `${road.lanes} làn` : 'chưa rõ số làn';
const dir = road.divided ? 'đường đôi' : road.oneway ? 'một chiều' : 'hai chiều';

console.log('');
console.log(`Đường        ${name}`);
console.log(`             ${roadLabel(m.road)} · ${lanes} · ${dir}  (cách điểm chấm ${m.dist.toFixed(0)} m, OSM way ${m.road.id})`);
console.log(`Đơn vị       ${[place.wardName, place.quarterName].filter(Boolean).join(' · ') || 'không nằm trong phường/xã nào trên bản đồ'}`);
console.log(road.expressway
  ? 'Đông dân cư  không áp dụng — cao tốc theo Điều 9'
  : `Đông dân cư  ${zone.inside ? 'CÓ' : 'KHÔNG'} (${conf[zone.confidence]}) — ${zone.reason}`);

if (flag('--tat-ca')) {
  console.log('');
  for (const [k, v] of Object.entries(VEHICLES)) {
    const r = limitFor(k);
    const val = r.max != null ? `${r.max} km/h` : `— (${r.range.join('–')})`;
    console.log(`  ${val.padEnd(14)} ${v.label}`);
  }
} else {
  const vehicle = opt('--xe', 'oto_con');
  if (!VEHICLES[vehicle]) {
    console.error(`Loại xe không hợp lệ. Chọn một trong: ${Object.keys(VEHICLES).join(', ')}`);
    process.exit(1);
  }
  const r = limitFor(vehicle);
  const val = r.max != null ? `${r.max} km/h` : `không đọc số (luật chỉ giới hạn ${r.range.join('–')})`;
  console.log(`Giới hạn     ${val} · ${tierLabel[r.tier]} · ${r.rule}`);
  console.log(`Xe           ${VEHICLES[vehicle].label}`);
  const notes = [...road.notes, ...r.notes];
  if (notes.length) {
    console.log('Giả định');
    for (const n of notes) console.log(`  - ${n}`);
  }
}
console.log('');
