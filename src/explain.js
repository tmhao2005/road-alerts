// Why a reported limit was wrong, from the one thing a driver can say for sure: the
// number on the sign.
//
// The app's limit is a function of a few facts about the road. If changing exactly one of
// them turns the app's number into the driver's number, that fact is the suspect. The
// driver answers the easy question; this answers the hard one.
//
// Pure: no imports. The caller passes the limit function in (statutoryLimit from limit.js),
// so the statute is never copied here.

// report: {
//   vehicle, road: { expressway, divided, oneway, lanes, inside },
//   zoneConfidence: 'cao' | 'trung_binh' | 'thap',
//   now:   the limit the app had computed at the tap, { max }
//   shown: the limit on screen at the tap, { max, tier }
// }
// limitFor(vehicle, road) -> { max }

// The single-fact changes worth testing, each with the road it would make.
function flips(road) {
  const out = [{ cause: 'zone', road: { ...road, inside: !road.inside } }];
  // Which column of the table: on the map, a missing median or lane count is common, a
  // wrongly mapped one is not, so the wide column is tried first.
  const wide = road.divided === true || (road.oneway === true && road.lanes >= 2);
  if (!wide) out.push({ cause: 'column', road: { ...road, divided: true } });
  else out.push({ cause: 'column', road: { ...road, divided: false, oneway: false } });
  return out;
}

// The numbers most likely on the sign, most likely first, each with what would explain it.
// These are what the post-drive card offers before the rest.
export function suggestions(report, limitFor) {
  const out = [];
  const add = (max, cause) => {
    if (max == null || max === report.shown.max || out.some((s) => s.max === max)) return;
    out.push({ max, cause });
  };
  // The app already had it right and was still holding the old number.
  if (report.now.max !== report.shown.max) add(report.now.max, 'lag');
  // A sign on the map overrides the statute, so no statutory fact can explain the number:
  // the suspect is the mapped sign itself, and the statute underneath is the likely truth.
  if (report.shown.tier === 'bien_bao') {
    add(limitFor(report.vehicle, report.road).max, 'mapsign');
    return out;
  }
  const tries = flips(report.road).map((f) => ({ cause: f.cause, max: limitFor(report.vehicle, f.road).max }));
  // A zone guess the app itself was unsure of is the better bet than the map's road shape.
  if (report.zoneConfidence === 'cao') tries.reverse();
  for (const t of tries) add(t.max, t.cause);
  return out;
}

// answer: a number, 'none' (no sign there) or 'unsure'.
// Returns { cause, max? }:
//   lag     the app had computed this number and was waiting to be sure of it
//   zone    the inside/outside khu đông dân cư guess is the wrong input
//   column  the map has the road's shape wrong (median, one-way, lanes)
//   mapsign the map has a sign here that the road no longer has
//   sign    no single fact explains it: a sign the map does not have
//   same    the driver's number is the app's number
//   none    there was no sign, so the statute was all there was to go on
//   unsure  nothing to learn yet
export function explain(report, answer, limitFor) {
  if (answer === 'unsure' || answer == null) return { cause: 'unsure' };
  if (answer === 'none') return { cause: 'none' };
  if (answer === report.shown.max) return { cause: 'same', max: answer };
  const hit = suggestions(report, limitFor).find((s) => s.max === answer);
  return hit ? { cause: hit.cause, max: answer } : { cause: 'sign', max: answer };
}
