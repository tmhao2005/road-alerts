// What the phone did not say about its movement, worked out from where it has been.
//
// Safari leaves speed and heading out whenever iOS has none, and iOS has none exactly when
// the phone is standing still. Worked out naively from two fixes, a parked phone's GPS
// wobble - often 5-10 m between one second and the next - reads as 20-40 km/h in a random
// direction: a speeding warning in a car park, and lights drawn ahead on a road nobody is
// driving. Wobble circles around where the phone stands and keeps changing direction;
// driving leaves that circle and keeps going the same way. So the phone starts moving
// once it leaves the circle, and stays moving while each step carries on roughly the way
// the last one went.
import { metresPerDegree, bearing, angleBetween } from './geo.js';

function metres(a, b) {
  const m = metresPerDegree(a.lat);
  return Math.hypot((a.lon - b.lon) * m.x, (a.lat - b.lat) * m.y);
}
const pt = (f) => [f.lon, f.lat];

// Returns fill(fix) for a stream of { lon, lat, acc, speed (m/s or null), heading (deg or
// null), t (ms) }. Each result carries speed and heading filled where they can be, where
// each came from, and `moved`: metres travelled since the previous fix, 0 when standing.
// circle: metres the phone must leave its standing spot by, at least, before it is moving.
// turn: degrees a step may turn from the previous one and still be the same drive.
export function makeFixFiller({ circle = 15, turn = 75 } = {}) {
  let last = null, anchor = null, moving = false, way = null;
  return function fill(fix) {
    const out = {
      ...fix,
      speedSrc: fix.speed != null ? 'gps' : null,
      headingSrc: fix.heading != null ? 'gps' : null,
      moved: 0,
    };
    if (!last) { last = anchor = fix; return out; }
    const step = metres(fix, last);
    const dt = (fix.t - last.t) / 1000;
    const stepWay = step > 0 ? bearing(pt(last), pt(fix)) : null;
    const was = moving;
    if (fix.speed != null) {
      moving = fix.speed > 1;
    } else if (!moving) {
      if (metres(fix, anchor) > Math.max(circle, 2 * (fix.acc || 0))) {
        moving = true;
        way = bearing(pt(anchor), pt(fix));
      }
    } else if (!(step > 3 && stepWay != null && angleBetween(stepWay, way) < turn)) {
      moving = false;
    }
    if (moving) {
      out.moved = step;
      if (out.speed == null && dt > 0.5) { out.speed = step / dt; out.speedSrc = 'derived'; }
      if (out.heading == null && stepWay != null) { out.heading = stepWay; out.headingSrc = 'derived'; }
      if (stepWay != null && step > 3) way = stepWay;
    } else {
      // The standing spot is set where the phone comes to rest, and then held: moved along
      // with each wobble, it would creep after a slow pull-away and never be left behind.
      if (was) anchor = fix;
      if (out.speed == null && dt > 0.5) { out.speed = 0; out.speedSrc = 'derived'; }
    }
    last = fix;
    return out;
  };
}
