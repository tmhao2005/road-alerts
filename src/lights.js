// Traffic lights ahead on the road being driven, and when to mention one. Kept free of the
// DOM so it can be tested without a phone.
//
// Warning about a light is correct whether or not a camera watches it, which is why this
// needs no camera data. The cost of getting it wrong is asymmetric the other way from
// speed limits: a missed light is silence, but a light announced on a road the driver is
// not taking trains them to ignore the voice. So the walk ahead only follows the road
// the car is on, and stops at any junction where that road is not obvious.
import { metres } from './geo.js';
import { walkAhead } from './path.js';

const MOVING = 2; // m/s; below this the heading is noise, and a car stopped at a light needs no warning

// Lights facing the car within `reach` metres ahead, nearest first.
// match: matchLive's result ({ piece, seg }); fix: { lon, lat, heading, speed }; bike: a
// xe máy.
export function lightsAhead(pieces, match, fix, reach, bike = false) {
  if (!match || fix.heading == null || !(fix.speed >= MOVING)) return [];
  return walkAhead(pieces, match, fix.heading, reach, [fix.lon, fix.lat], bike).lights;
}

// How far ahead to look: about eight seconds of driving, so the warning arrives with time
// to ease off, but never so far that it names a light two junctions away in the city.
export function reachFor(speed, { seconds = 8, min = 80, max = 300 } = {}) {
  return Math.max(min, Math.min(max, (speed || 0) * seconds));
}

// Decides which light to speak, once. Two things make a naive "nearest light" repeat
// itself: a light where two roads meet is stored on both, and one junction is often
// mapped as several signal nodes a few metres apart (one per approach, or one per
// carriageway). So each node is spoken at most once, and nothing is spoken within
// `cluster` metres of the light last spoken.
export function makeLightWatcher({ cluster = 60, tooClose = 20 } = {}) {
  const said = new Set();
  let lastAt = null;
  return function next(ahead) {
    const light = ahead[0] || null;
    if (!light || said.has(light.id)) return { next: light, speak: null };
    said.add(light.id);
    if (said.size > 500) said.clear();
    // Already at the stop line: saying "ahead" now is noise.
    if (light.dist < tooClose) return { next: light, speak: null };
    if (lastAt && metres(lastAt, light.at) < cluster) return { next: light, speak: null };
    lastAt = light.at;
    return { next: light, speak: light };
  };
}

export function lightPhrase(light) {
  return light.crossing ? 'Đèn qua đường phía trước' : 'Đèn giao thông phía trước';
}
