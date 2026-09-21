// Turn a coordinate into the facts the speed rules need: which road, what kind, and
// which ward / khu phố / residential area it sits in. Map-dependent, so kept apart from
// the pure rule modules.
import { pointSegment, pointInRings, inBbox } from './geo.js';

const CELL = 0.005; // ~550 m; a road match only ever looks one cell around the point
const key = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;

const EXPRESSWAY = new Set(['motorway', 'motorway_link']);
// A one-way way of this class is almost always one carriageway of a divided road.
const MAJOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary']);

export function buildIndex(data) {
  const grid = new Map();
  const put = (k, v) => { let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(v); };
  data.roads.forEach((road, ri) => {
    for (let i = 0; i < road.c.length - 1; i++) {
      const [a, b] = [road.c[i], road.c[i + 1]];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) put(`${x}:${y}`, [ri, i]);
    }
  });
  return { ...data, grid };
}

// Service roads are parking aisles and driveways as often as real roads, so they only
// win when nothing else is close. Bigger roads get a small edge so that a point sitting
// on a node two roads share - every junction - resolves to the through road rather than
// to whichever side street happened to be indexed first.
const PENALTY = {
  service: 12, residential: 0, living_street: 0, unclassified: 0,
  tertiary: -1, tertiary_link: -1, secondary: -2, secondary_link: -2,
  primary: -3, primary_link: -3, trunk: -4, trunk_link: -4, motorway: -4, motorway_link: -4,
};

export function matchRoad(index, p, maxDist = 35) {
  const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
  let best = null;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const [ri, si] of index.grid.get(`${cx + dx}:${cy + dy}`) || []) {
      const road = index.roads[ri];
      const { dist } = pointSegment(p, road.c[si], road.c[si + 1]);
      const score = dist + (PENALTY[road.highway] || 0);
      if (dist <= maxDist && (!best || score < best.score)) best = { road, dist, score };
    }
  }
  return best;
}

function containing(list, p) {
  return list.filter((a) => inBbox(p, a.b) && pointInRings(p, a.r));
}

const num = (v) => {
  const n = parseInt(String(v || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Everything the rules read, plus a note for each assumption made along the way.
export function roadFacts(road) {
  const notes = [];
  const oneway = ['yes', '1', 'true', '-1'].includes(road.oneway) || road.junction === 'roundabout'
    || EXPRESSWAY.has(road.highway);
  const lanes = num(road.lanes);
  let divided = null;
  if (oneway && MAJOR.has(road.highway)) {
    divided = true;
    notes.push('Đường một chiều loại lớn → coi là một nửa của đường đôi');
  }
  if (lanes == null) notes.push('Bản đồ không ghi số làn');

  // With a single point there is no heading, so when the two directions are signed
  // differently, take the lower one.
  const f = num(road.maxF), b = num(road.maxB), both = num(road.maxspeed);
  let sign = both;
  if (f != null || b != null) {
    sign = Math.min(...[f, b].filter((x) => x != null));
    if (f != null && b != null && f !== b) notes.push(`Hai chiều có biển khác nhau (${f}/${b}) → lấy số thấp hơn`);
  }

  return {
    highway: road.highway,
    expressway: EXPRESSWAY.has(road.highway) || road.expressway === 'yes',
    oneway, lanes, divided, sign, notes,
  };
}

export function placeFacts(index, p) {
  const ward = containing(index.wards, p)[0] || null;
  const quarter = containing(index.quarters, p)[0] || null;
  const inResidential = containing(index.residential, p).length > 0;
  return {
    ward: ward ? ward.kind : null, wardName: ward ? ward.name : null,
    quarter: quarter ? quarter.kind : null, quarterName: quarter ? quarter.name : null,
    inResidential,
  };
}

export function roadLabel(road) {
  const ref = (road.ref || '').toUpperCase().replace(/[\s.]/g, '');
  if (EXPRESSWAY.has(road.highway) || /^CT\d/.test(ref)) return 'Cao tốc';
  if (/^QL\d/.test(ref)) return 'Quốc lộ';
  if (/^(ĐT|DT|TL)\d/.test(ref)) return 'Tỉnh lộ';
  return {
    trunk: 'Đường trục chính', trunk_link: 'Nhánh nối', primary: 'Đường chính', primary_link: 'Nhánh nối',
    secondary: 'Đường lớn', secondary_link: 'Nhánh nối', tertiary: 'Đường phố', tertiary_link: 'Nhánh nối',
    unclassified: 'Đường nhỏ', residential: 'Hẻm / đường nội khu', living_street: 'Hẻm / đường nội khu',
    service: 'Đường nội bộ', road: 'Đường chưa phân loại',
  }[road.highway] || road.highway;
}
