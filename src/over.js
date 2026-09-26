// When to tell a driver they are over the limit, and how firmly.
//
// A warning that fires while the driver is legal teaches them to ignore it, and then it is
// no use on the day it is right. So each rule here removes a way of warning someone who is
// doing nothing wrong:
//
// - The number goes red from 2 km/h over, two fixes running, and stays red until back at
//   the limit, so neither a car cruising on it nor one GPS speed spike makes it flicker.
//   Two, because the matcher reaches a new road a fix after the car does, and a driver
//   speeding up past a higher limit would otherwise be shown red for that one fix.
// - The voice waits for 5 km/h over, held for 3 s. Nghị định 168/2024 fines nothing below
//   5 over, so under that the voice would be a warning about nothing.
// - It escalates once, at 10 over: for a car that is where the fine goes from under a
//   million đồng to 4-6 million and two licence points (Điều 6, khoản 5, điểm đ).
// - Seconds spent slowing down do not count. A driver who is already braking has heard
//   the message; saying it again is nagging.
// - A lower limit gives the driver time to react before the count starts, since nobody
//   is over the instant they pass the sign.
// - A higher limit counts from the first fix on it, not once the badge has caught up. The
//   badge is slow to raise a limit, which is the safe way round for a badge and the wrong
//   way round for a warning: it would scold someone for speeding up past the sign.
//
// Once said, each level stays said until the driver has been back at the limit for a
// while, so one stretch of fast driving gets one warning, not one per wobble.

export const RED = 2;          // km/h over before the number turns red
export const SPEAK = 5;        // km/h over before the voice says anything
export const FAR = 10;         // km/h over before it says it again, firmer
const HOLD = 3000;             // ms over, not slowing, before a warning
const REACT = 3000;            // ms after a lower limit before the count starts
const CLEAR = 5000;            // ms back at the limit before a warning can be said again
const SLOWING = 3;             // km/h lost over the last couple of seconds that counts as braking
const GAP = 2000;              // longest step counted at once, so a gap in fixes is not time over

// shown: the { max, tier } on the badge; pending: a value the stabiliser is still waiting
// on, or null. A higher pending limit is the one the driver is judged against.
export function judged(shown, pending) {
  if (!shown || shown.max == null) return null;
  if (pending && pending.max != null && pending.max > shown.max) return pending;
  return shown;
}

// Feed it every fix: { t (ms), kmh, limit: { max, tier } | null }.
// Returns { red, say }, where say is null or { level: 'over' | 'far', max, tier }.
export function makeOverWatch() {
  let red = false, lastT = null, lastMax = null, lastExcess = -Infinity, reactUntil = 0;
  let over = 0, far = 0, under = 0;   // ms counted towards each
  let saidOver = false, saidFar = false;
  const recent = [];                  // { t, kmh } for the last few seconds

  const reset = () => { over = far = under = 0; saidOver = saidFar = false; };

  return function next({ t, kmh, limit }) {
    const dt = lastT == null ? 0 : Math.max(0, Math.min(GAP, t - lastT));
    lastT = t;
    const max = limit ? limit.max : null;
    if (kmh == null || max == null) {
      red = false; lastMax = max; lastExcess = -Infinity; recent.length = 0; reset();
      return { red, say: null };
    }

    if (lastMax != null && max < lastMax) { reset(); reactUntil = t + REACT; lastExcess = -Infinity; }
    lastMax = max;

    while (recent.length && t - recent[0].t > 3000) recent.shift();
    const before = recent.find((s) => t - s.t >= 1500);
    const slowing = !!before && before.kmh - kmh >= SLOWING;
    recent.push({ t, kmh });

    const excess = kmh - max, was = lastExcess;
    lastExcess = excess;
    if (!red && excess >= RED && was >= RED) red = true;
    else if (red && excess <= 0) red = false;

    if (excess <= 0) {
      over = far = 0;
      under += dt;
      if (under >= CLEAR) saidOver = saidFar = false;
      return { red, say: null };
    }
    under = 0;
    // Only the time since the previous fix, and only if that fix was already this far
    // over: when in between the car crossed the line is not known, so none of it counts.
    const counted = slowing ? 0 : Math.max(0, Math.min(dt, t - reactUntil));
    over = excess >= SPEAK ? over + (was >= SPEAK ? counted : 0) : 0;
    far = excess >= FAR ? far + (was >= FAR ? counted : 0) : 0;

    let say = null;
    if (!saidFar && far >= HOLD) { saidFar = saidOver = true; say = { level: 'far', max, tier: limit.tier }; }
    else if (!saidOver && over >= HOLD) { saidOver = true; say = { level: 'over', max, tier: limit.tier }; }
    return { red, say };
  };
}
