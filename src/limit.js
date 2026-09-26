// Maximum speed from Thông tư 38/2024/TT-BGTVT (effective 2025-01-01), read from the
// official PDF rather than a news summary.
//
// Pure: no imports, no I/O, so the same file runs under `node --test` and in the
// browser. Every result names the rule that produced it, so a wrong number can be traced
// to a wrong input instead of argued about.

// Groups follow the rows of Bảng 2. Điều 7 and 8 vehicles carry a flat cap instead,
// and Bảng 1 explicitly excludes them.
export const VEHICLES = {
  oto_con:            { label: 'Ô tô ≤ 28 chỗ, tải ≤ 3,5 tấn', row: 1 },
  oto_lon:            { label: 'Ô tô > 28 chỗ, tải > 3,5 tấn', row: 2 },
  xe_mo_to:           { label: 'Xe mô tô (> 50 cc)', row: 3, twoWheeler: true },
  xe_buyt:            { label: 'Xe buýt, đầu kéo sơ mi rơ moóc, ô tô chuyên dùng', row: 3 },
  keo_ro_mooc:        { label: 'Ô tô kéo rơ moóc, trộn bê tông, xi téc', row: 4 },
  xe_gan_may:         { label: 'Xe gắn máy (≤ 50 cc)', cap: 40, capRule: 'Điều 7', twoWheeler: true },
  xe_may_chuyen_dung: { label: 'Xe máy chuyên dùng', cap: 40, capRule: 'Điều 7' },
  xe_4b_cho_nguoi:    { label: 'Xe bốn bánh có gắn động cơ chở người', cap: 30, capRule: 'Điều 8 khoản 1' },
  xe_4b_cho_hang:     { label: 'Xe bốn bánh có gắn động cơ chở hàng', cap: 50, capRule: 'Điều 8 khoản 2' },
};

// [wide column, narrow column]. Wide = "đường đôi; đường một chiều có từ hai làn xe cơ
// giới trở lên". Narrow = "đường hai chiều; đường một chiều có một làn xe cơ giới".
const BANG_1 = [60, 50];
const BANG_2 = { 1: [90, 80], 2: [80, 70], 3: [70, 60], 4: [60, 50] };

// A two-way undivided road takes the narrow column however many lanes it has; lane count
// only decides the column for one-way roads. Unknown means narrow: the lower number is
// the one that cannot get a driver fined.
export function column(road) {
  if (road.divided === true) return { wide: true, why: 'đường đôi' };
  if (road.oneway === true && road.lanes >= 2) return { wide: true, why: `một chiều, ${road.lanes} làn` };
  if (road.oneway === true && road.lanes == null) return { wide: false, why: 'một chiều, chưa rõ số làn → lấy cột thấp' };
  if (road.oneway === true) return { wide: false, why: 'một chiều, 1 làn' };
  if (road.divided == null) return { wide: false, why: 'hai chiều (không có dải phân cách trên bản đồ)' };
  return { wide: false, why: 'hai chiều' };
}

// road: { expressway, divided, oneway, lanes, inside }
// inside: true/false for khu đông dân cư. The caller owns that guess and its confidence.
export function statutoryLimit(vehicleKey, road) {
  const v = VEHICLES[vehicleKey];
  if (!v) throw new Error(`unknown vehicle: ${vehicleKey}`);

  // Điều 9 bounds a cao tốc but never sets its limit - that lives in each route's
  // approved traffic plan and must be signposted. Inventing a number here is exactly the
  // failure the app exists to avoid.
  //
  // Xe mô tô and xe gắn máy may not go on a cao tốc at all, so no sign there is theirs. A
  // two-wheeler that seems to be on one has been matched to it by mistake - the road it is
  // really on runs alongside - and the expressway's 100 would be a number for someone else.
  if (road.expressway) {
    if (v.twoWheeler) return { max: null, barred: true, rule: 'Xe hai bánh không được đi vào cao tốc', notes: [] };
    return { max: null, min: 60, range: [60, 120], rule: 'Điều 9', notes: ['Tối đa 120, tối thiểu 60; số thật nằm trên biển của từng tuyến'] };
  }

  // Điều 7 and 8 apply everywhere except cao tốc, inside or outside đông dân cư alike.
  if (v.cap) {
    return { max: v.cap, rule: v.capRule, notes: [] };
  }

  const col = column(road);
  const i = col.wide ? 0 : 1;
  if (road.inside) {
    return { max: BANG_1[i], rule: `Bảng 1, ${col.wide ? 'cột 1' : 'cột 2'}`, notes: [col.why] };
  }
  return { max: BANG_2[v.row][i], rule: `Bảng 2, dòng ${v.row}, ${col.wide ? 'cột 1' : 'cột 2'}`, notes: [col.why] };
}

// A posted sign overrides the statutory default (Điều 4.2). Flat-cap vehicles keep their
// own ceiling: a road signed 60 does not let a xe gắn máy do more than 40.
export function withSign(vehicleKey, statutory, signMax) {
  if (signMax == null || statutory.barred) return { ...statutory, tier: statutory.max == null ? 'khong_ro' : 'theo_luat' };
  const v = VEHICLES[vehicleKey];
  const max = v.cap ? Math.min(signMax, v.cap) : signMax;
  const notes = [...statutory.notes];
  if (v.cap && signMax > v.cap) notes.push(`Biển ghi ${signMax}, nhưng ${v.capRule} giới hạn xe này ở ${v.cap}`);
  return { max, rule: 'Biển báo trên bản đồ', notes, tier: 'bien_bao', statutoryMax: statutory.max };
}
