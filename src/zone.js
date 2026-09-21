// Guess whether a point is inside khu đông dân cư.
//
// The law defines the zone by physical signs (Điều 3.1), and OSM maps 17 of them
// nationwide, so this is always a guess about where the signs are. It returns its
// confidence and its reason, because the test drive exists to find out which of these
// rules are wrong.
//
// Pure: takes pre-computed map facts, no imports.

const MINOR = new Set(['residential', 'living_street', 'service']);
const TRUNK = new Set(['motorway', 'trunk', 'primary']);

// facts: {
//   highway:        OSM highway class of the matched road
//   ward:           'phuong' | 'xa' | null   (admin_level 6)
//   quarter:        'khu_pho' | 'ap' | null  (admin_level 9)
//   inResidential:  inside a landuse=residential area
// }
export function guessZone(facts) {
  const { highway, ward, quarter, inResidential } = facts;

  // The law's own wording is "nội thành phố, nội thị xã, nội thị trấn": wards are the
  // urban units, so a phường is the strongest clue the map has.
  if (ward === 'phuong') {
    // A quốc lộ through the outer wards is where a sign can still declare the stretch
    // outside - post-2025 wards are large and some are semi-rural. Keep it, but say so.
    if (TRUNK.has(highway)) {
      return { inside: true, confidence: 'trung_binh', reason: 'Trong phường, nhưng là trục lớn — biển có thể khác' };
    }
    return { inside: true, confidence: 'cao', reason: 'Trong phường (nội thành)' };
  }

  if (ward === 'xa') {
    if (MINOR.has(highway)) {
      return { inside: true, confidence: 'trung_binh', reason: 'Đường nhỏ trong xã — coi là trong khu dân cư cho an toàn' };
    }
    if (quarter === 'khu_pho') {
      return { inside: true, confidence: 'trung_binh', reason: 'Xã nhưng thuộc khu phố' };
    }
    // The hard case: houses often line a quốc lộ for kilometres between villages, and
    // the map calls all of it residential while the signs may say otherwise.
    if (inResidential) {
      return { inside: true, confidence: 'thap', reason: 'Xã, có nhà dọc đường — biển có thể ghi ngoài khu đông dân cư' };
    }
    return { inside: false, confidence: 'thap', reason: 'Xã, không có khu dân cư trên bản đồ' };
  }

  // Every point in Vietnam belongs to some phường or xã, so reaching here means the map
  // is missing that boundary - a data gap, not open country. Assume the lower limit
  // rather than hand out a 90 on the strength of missing data.
  return { inside: true, confidence: 'thap', reason: 'Bản đồ thiếu ranh giới phường/xã — tạm lấy giới hạn thấp' };
}
