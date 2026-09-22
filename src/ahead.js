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
// shown: the { key, max } on the badge now. Returns [{ dist, at, bearing, value }], where
// dist is where the new value starts, not where the badge will switch.
export function limitsAhead(walk, judge, shown, options) {
  if (!shown) return [];
  const next = makeStabiliser(options);
  next(shown, 0);
  const out = [];
  let run = null; // where the current stretch of one value began
  for (const leg of walk.legs) {
    const value = judge(leg.piece);
    if (!run || run.value.key !== value.key) run = { value, dist: leg.start };
    for (let s = leg.start; s < leg.end; s += STEP) {
      const step = Math.min(STEP, leg.end - s);
      const r = next(value, step);
      if (r.changed && value.max != null) {
        const p = pointAt(walk, run.dist);
        out.push({ dist: run.dist, at: p.at, bearing: p.bearing, value });
      }
    }
  }
  return out;
}
