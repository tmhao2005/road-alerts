// The next limits along the road ahead, for the signs drawn on the right shoulder.
//
// A sign on the shoulder is a promise that the badge will change there, so it has to be
// decided the same way the badge is: the ahead walk is fed through a fresh stabiliser
// seeded with what is shown now. A short stretch the badge would ignore - a junction
// piece, a road mapped in inconsistent bits - therefore never gets a sign either. A limit
// that is not yet known ahead gets no sign, as it gets no voice.
import { makeStabiliser } from './live.js';
import { pointAt } from './path.js';

const STEP = 5; // metres per stabiliser step; far finer than GPS fixes, so no change is missed

// walk: path.js walkAhead's result. judge(piece) -> { key, max, ... } for that piece.
// shown: the { key, max } on the badge now. taught: [{ from, to, value }], stretches of the
// walk where a sign the driver taught overrides the pieces. Returns
// [{ dist, at, bearing, value }], where dist is where the new value starts, not where the
// badge will switch.
export function limitsAhead(walk, judge, shown, options, taught = []) {
  if (!shown) return [];
  const next = makeStabiliser(options);
  next(shown, 0);
  const out = [];
  let run = null; // where the current stretch of one value began
  let inside = null; // the taught stretch the last step was in
  for (const leg of walk.legs) {
    const own = judge(leg.piece);
    // Where a value can change: where this leg starts, and where a taught stretch starts or ends.
    const edges = [leg.start, ...taught.flatMap((r) => [r.from, r.to])];
    for (let s = leg.start; s < leg.end; s += STEP) {
      const t = taught.find((r) => s >= r.from && s < r.to);
      const value = t ? t.value : own;
      // Dated from the edge that changed it, not the step that noticed. The steps move with
      // the car, and the HUD knows a sign by where it stands: one that moved every fix was
      // drawn afresh each time while the last one faded, a flickering stack of the same sign.
      if (!run || run.value.key !== value.key) run = { value, dist: Math.max(...edges.filter((d) => d <= s)) };
      const step = Math.min(STEP, leg.end - s);
      // The badge takes a taught sign's number as the car passes it, so its sign is
      // promised there too, however short the stretch.
      const r = next(value, step, !!t && t !== inside && Number.isFinite(t.from));
      inside = t;
      if (r.changed && value.max != null) {
        const p = pointAt(walk, run.dist);
        out.push({ dist: run.dist, at: p.at, bearing: p.bearing, value });
      }
    }
  }
  return out;
}

// The taught stretches as the road ahead is tinted: joined where the badge rides through
// what lies between them. A junction a few metres before the next taught sign ends the
// first in law, but the badge never shows the law's number for those metres and no sign
// stands there, so a sliver of another colour would promise a change that never comes.
// taught: [{ from, to }]; limits: limitsAhead's result over the same walk.
export function tintAhead(taught, limits) {
  const out = [];
  for (const t of [...taught].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && !limits.some((l) => l.dist >= last.to && l.dist < t.from)) last.to = Math.max(last.to, t.to);
    else out.push({ from: t.from, to: t.to });
  }
  return out;
}
