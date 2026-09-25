// Trips: when one is over, what is kept of it, and what else on it deserves a second look.
//
// A web app cannot know when the engine is off. It sees positions, time, and whether it is
// on screen - so "the trip is over" is a judgement from those, made so that being wrong is
// harmless: the review it opens folds away again the moment the car moves.
//
// Pure: no imports, so the same file runs under `node --test` and in the browser.

const DAY = 24 * 3600e3;

// A red light in Vietnam is rarely over two minutes, and a jam still creeps; five minutes
// without going anywhere is parked, fuelling or a coffee.
export const STILL = { ms: 5 * 60e3, metres: 50, kmh: 3 };
// Hidden this long, the trip ended: iOS does not keep a web page running with the screen off.
export const GAP_MS = 10 * 60e3;
// Driving again: the review gets out of the way and a new trip starts.
export const MOVING_KMH = 10;
export const PENDING_MS = 7 * DAY;   // after a week nobody remembers the sign
export const SENT_MS = 7 * DAY;      // how long a report stays after it has been sent
export const KEEP_TRACES = 5;        // full traces are the bulk of what is stored

const K = Math.PI / 180;
function metres(a, b) {
  const x = (b[0] - a[0]) * 6371008.8 * K * Math.cos(a[1] * K);
  const y = (b[1] - a[1]) * 6371008.8 * K;
  return Math.hypot(x, y);
}

// Feed it every fix: { t (ms), lon, lat, kmh }. It answers whether the car has been still
// long enough, and flags the one fix at which that first became true.
export function makeStillness({ ms, metres: radius, kmh } = STILL) {
  let anchor = null, since = null, fired = false;
  return function next(fix) {
    const p = [fix.lon, fix.lat];
    // No speed reading is not evidence of driving; the distance test still applies.
    const slow = fix.kmh == null || fix.kmh < kmh;
    if (!slow || (anchor && metres(anchor, p) > radius)) {
      anchor = slow ? p : null;
      since = slow ? fix.t : null;
      fired = false;
      return { still: false, ended: false };
    }
    if (!anchor) { anchor = p; since = fix.t; }
    const still = fix.t - since >= ms;
    const ended = still && !fired;
    if (ended) fired = true;
    return { still, ended };
  };
}

// The seconds before a tap, [{ t, lon, lat, kmh, shown }]: the index where the number on
// screen last changed, which is where the app's mistake most likely began. 0 when it did
// not change inside the window.
export function lastChange(window) {
  for (let i = window.length - 1; i > 0; i--) if (window[i].shown !== window[i - 1].shown) return i;
  return 0;
}

// Reports still waiting for an answer, newest first.
export function pending(reports, now) {
  return reports
    .filter((r) => !r.reviewedAt && now - Date.parse(r.t) < PENDING_MS)
    .sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
}

// What survives. A report is the point of the whole exercise, so it is only dropped once
// it has been sent and a week has passed; traces are kept for the newest trips only.
export function retain(reports, trips, now) {
  const sorted = [...trips].sort((a, b) => b.id - a.id);
  return {
    reports: reports.filter((r) => !(r.sentAt && now - Date.parse(r.sentAt) > SENT_MS)),
    trips: sorted.slice(0, KEEP_TRACES),
    dropped: sorted.slice(KEEP_TRACES).map((t) => t.id),
  };
}

// Whether a trip never went anywhere: the drive screen opened on a parked car and closed
// again. Not a drive, and kept, it would push a real drive's trace out of the few that are
// kept. It moved if it ever reached MOVING_KMH, or left where it started by more than GPS
// wander; with no position at all, it did not. entries: { lon, lat, kmh } in any order of
// arrival, such as a trace or the live fixes.
export function stood(entries, { metres: radius = STILL.metres, kmh = MOVING_KMH } = {}) {
  let first = null;
  for (const e of entries) {
    if (e.kmh != null && e.kmh >= kmh) return false;
    if (e.lat == null || e.lon == null) continue;
    if (!first) first = [e.lon, e.lat];
    else if (metres(first, [e.lon, e.lat]) > radius) return false;
  }
  return true;
}

// Metres driven, from a trace of snapshots a few seconds apart. A gap in the trace (the
// app in the background) is skipped rather than drawn as a straight line.
export function distance(trace) {
  let sum = 0, prev = null;
  for (const e of trace) {
    if (e.lat == null || e.lon == null) continue;
    const t = Date.parse(e.t);
    if (prev && t - prev.t <= 60e3) sum += metres([prev.lon, prev.lat], [e.lon, e.lat]);
    prev = { t, lon: e.lon, lat: e.lat };
  }
  return sum;
}

// Once a driver has said what went wrong at one place, the same wrong input was probably
// in play elsewhere on the trip. These are the stretches of the trace where it was, away
// from the report itself, as a short list worth a yes or no each.
//   zone:   the same zone reason, showing the same number
//   column: the same road, the same rule, the same number (a map defect is per road)
export function similarStretches(trace, report, cause, { away = 300, gap = 30e3, max = 5 } = {}) {
  const same = cause === 'zone'
    ? (e) => e.zone && e.zone.reason === report.zone.reason && e.shown && e.shown.max === report.shown.max
    : cause === 'column'
      ? (e) => e.road === report.road && e.shown && e.shown.rule === report.shown.rule && e.shown.max === report.shown.max
      : null;
  if (!same) return [];
  const here = [report.lon, report.lat];
  const out = [];
  let run = null;
  for (const e of trace) {
    if (e.type !== 'trace' || e.lat == null) continue;
    const t = Date.parse(e.t);
    const hit = same(e) && metres(here, [e.lon, e.lat]) > away;
    if (hit && run && t - run.last <= gap) { run.points.push(e); run.last = t; continue; }
    if (run) { out.push(run); run = null; }
    if (hit) run = { points: [e], last: t };
  }
  if (run) out.push(run);
  return out.slice(0, max).map(({ points }) => {
    const mid = points[Math.floor(points.length / 2)];
    return { t: points[0].t, lat: mid.lat, lon: mid.lon, road: mid.road, ward: mid.ward, points: points.length };
  });
}

// When something happened, the way people say it: "sáng nay", "chiều hôm qua", "tối 21/9".
// Vietnam local time, as plain UTC+7 arithmetic.
export function whenLabel(iso, now) {
  const a = new Date(Date.parse(iso) + 7 * 3600e3), b = new Date(now + 7 * 3600e3);
  const h = a.getUTCHours();
  const part = h < 4 ? 'đêm' : h < 11 ? 'sáng' : h < 13 ? 'trưa' : h < 18 ? 'chiều' : h < 22 ? 'tối' : 'đêm';
  const day = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((day(b) - day(a)) / DAY);
  if (diff <= 0) return `${part} nay`;
  if (diff === 1) return `${part} hôm qua`;
  return `${part} ${a.getUTCDate()}/${a.getUTCMonth() + 1}`;
}
