// Which way a vehicle may drive along a piece of road.
//
// Some Vietnamese one-way streets are one-way for cars only: xe máy may ride both ways
// (Phạm Ngũ Lão, Lê Lai, Cách Mạng Tháng Tám among ~190 in central TP.HCM). OSM maps
// that as oneway:motorcycle=no, carried in the tiles as `onewayMoto`. Road matching, the
// walk ahead and the arrows drawn on one-way streets all read this one rule, so a rider
// going legally against the cars is neither matched to a side street nor shown an arrow
// telling them they are going the wrong way.
//
// Pure: no imports, so it runs under `node --test` and in the browser.

const ONE = new Set(['yes', '1', 'true']);

// 1 along the piece's vertex order, -1 against it, 0 either way.
// bike: the vehicle is a xe máy (mô tô or gắn máy).
export function travel(piece, bike = false) {
  const own = bike ? piece.onewayMoto : null;
  if (own === 'no') return 0;
  const way = own === 'yes' || own === '-1' ? own : piece.oneway;
  if (way === '-1') return -1;
  if (ONE.has(way) || piece.junction === 'roundabout' || /^motorway/.test(piece.highway)) return 1;
  return 0;
}
