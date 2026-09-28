import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signsFrom, withdrawal, reachOf, passed, along, crossings, stretchEnd, onStretch, headingAt, lessonFrom, signsOn, REACH } from './learn.js';
import { walkAhead } from './path.js';
import { limitsAhead } from './ahead.js';

// A secondary road running north for 2.2 km, mapped as two ways that share an id, with a
// hẻm off it at 10.803, a tertiary street crossing at 10.805, a driveway at 10.81 and
// another tertiary at 10.815. 0.001° of latitude is about 111 m.
const LON = 106.9;
const pt = (lat) => [LON, lat];
const north = (from, to) => Array.from({ length: Math.round((to - from) / 0.001) + 1 }, (_, i) => pt(+(from + i * 0.001).toFixed(3)));
const road1 = { id: 1, highway: 'secondary', name: 'Đèo', c: north(10.8, 10.805) };
const road2 = { id: 1, highway: 'secondary', name: 'Đèo', c: north(10.805, 10.82) };
const side = (id, highway, lat) => ({ id, highway, c: [[LON - 0.002, lat], pt(lat), [LON + 0.002, lat]] });
const pieces = [road1, road2, side(2, 'residential', 10.803), side(3, 'tertiary', 10.805), side(4, 'service', 10.81), side(5, 'tertiary', 10.815)];

// The car just past a sign at 10.801, heading north.
const car = pt(10.8012);
const walk = walkAhead(pieces, { piece: road1, seg: 1, t: 0.2 }, 0, REACH, car);
const M = 111195 * 0.001; // metres in 0.001° of latitude
const near = (a, b, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} is not about ${b}`);

const sign = (over = {}) => ({ id: 1, at: [LON + 0.0001, 10.801], heading: 0, max: 30, seen: 1, marks: [], ...over });
const lesson = (over = {}) => ({ id: 1, t: '2026-09-27T01:00:00Z', kind: 'sign', at: [LON + 0.0001, 10.801], heading: 0, max: 30, ...over });

test('two answers about the same sign make one sign, seen twice', () => {
  const signs = signsFrom([lesson(), lesson({ id: 2, t: '2026-09-28T01:00:00Z', at: [LON + 0.0001, 10.8012] })]);
  assert.equal(signs.length, 1);
  assert.equal(signs[0].seen, 2);
  assert.equal(signs[0].id, 1);
});

test('a newer number replaces the old one and starts counting again', () => {
  const [s] = signsFrom([lesson(), lesson({ id: 2, t: '2026-09-28T01:00:00Z' }), lesson({ id: 3, t: '2026-09-29T01:00:00Z', max: 40 })]);
  assert.equal(s.max, 40);
  assert.equal(s.seen, 1);
});

test('the same spot facing the other way is a different sign', () => {
  assert.equal(signsFrom([lesson(), lesson({ id: 2, heading: 180 })]).length, 2);
});

test('answers are read oldest first, whatever order they are stored in', () => {
  const [s] = signsFrom([lesson({ id: 3, t: '2026-09-29T01:00:00Z', max: 40 }), lesson()]);
  assert.equal(s.max, 40);
});

test('where the driver dragged the sign beats where they tapped', () => {
  const dragged = [LON + 0.0001, 10.8008];
  const [s] = signsFrom([lesson({ placed: true, at: dragged }), lesson({ id: 2, t: '2026-09-28T01:00:00Z' })]);
  assert.deepEqual(s.at, dragged);
});

test('a sign said not to be there is forgotten; marks stay with their sign', () => {
  const at = pt(10.804);
  const signs = signsFrom([lesson(), lesson({ id: 2, kind: 'ended', sign: 1, at }), lesson({ id: 3, kind: 'still', sign: 9, at })]);
  assert.deepEqual(signs[0].marks, [{ kind: 'ended', at }]);
  assert.equal(signsFrom([lesson(), lesson({ id: 2, t: '2026-09-28T01:00:00Z', kind: 'gone', sign: 1 })]).length, 0);
});

test('a withdrawn answer is as if it had never been given', () => {
  const t = '2026-09-28T01:00:00Z';
  assert.equal(signsFrom([lesson(), { id: 'w1', t, kind: 'withdrawn', lesson: 1 }]).length, 0);
  // Withdrawn first and then answered again, the new answer stands.
  const again = signsFrom([lesson(), { id: 'w1', t, kind: 'withdrawn', lesson: 1 }, lesson({ id: 2, t: '2026-09-29T01:00:00Z', max: 40 })]);
  assert.deepEqual(again.map((s) => [s.id, s.max, s.seen]), [[2, 40, 1]]);
});

test('taking back a sign withdraws every answer it came from, its marks too', () => {
  const lessons = [lesson(), lesson({ id: 2, t: '2026-09-28T01:00:00Z' }), lesson({ id: 3, t: '2026-09-28T02:00:00Z', kind: 'ended', sign: 1, at: pt(10.804) })];
  const [s] = signsFrom(lessons);
  assert.deepEqual(s.lessons, [1, 2, 3]);
  assert.equal(s.t, '2026-09-28T01:00:00Z', 'dated by the newest answer about the sign itself');
  const back = withdrawal(s, '2026-09-29T01:00:00Z');
  assert.deepEqual(back.map((l) => [l.kind, l.lesson]), [['withdrawn', 1], ['withdrawn', 2], ['withdrawn', 3]]);
  assert.equal(signsFrom([...lessons, ...back]).length, 0);
});

test('withdrawing is not saying the sign is gone: another answer about it stands', () => {
  // As when two phones' answers are joined: this phone takes its own back, the other's stays.
  const mine = lesson(), theirs = lesson({ id: 2, t: '2026-09-28T01:00:00Z' });
  const [s] = signsFrom([mine, theirs, { id: 'w1', t: '2026-09-29T01:00:00Z', kind: 'withdrawn', lesson: 1 }]);
  assert.deepEqual([s.id, s.seen], [2, 1]);
});

test('a sign is passed when the car goes by it, its way, beside the road', () => {
  const s = sign();
  assert.equal(passed([s], pt(10.8009), pt(10.8011)), s);
  assert.equal(passed([s], pt(10.8005), pt(10.8008)), null, 'not reached yet');
  assert.equal(passed([s], pt(10.8011), pt(10.8009)), null, 'going the other way');
  assert.equal(passed([sign({ at: [LON + 0.0005, 10.801] })], pt(10.8009), pt(10.8011)), null, '55 m off: another road');
  assert.equal(passed([s], pt(10.8011), pt(10.8011)), null, 'standing still');
});

test('a sign on the outside of a bend is not lost between two steps', () => {
  // Heading north-east then east: the sign stands just past the corner of the first step.
  const corner = [LON, 10.801], s = sign({ at: [LON + 0.00002, 10.80104], heading: 60 });
  const steps = [[[LON - 0.00004, 10.80098], corner], [corner, [LON + 0.00005, 10.801]]];
  assert.ok(steps.some(([a, b]) => passed([s], a, b)));
});

test('only a real road crossing ends a sign below the law; any road ends one above it', () => {
  near(crossings(walk, pieces)[0], (10.805 - 10.8012) * 1000 * M);
  near(crossings(walk, pieces, true)[0], (10.803 - 10.8012) * 1000 * M);
  near(stretchEnd(walk, sign(), { pieces, law: 60 }).end, (10.805 - 10.8012) * 1000 * M);
  near(stretchEnd(walk, sign({ max: 80 }), { pieces, law: 60 }).end, (10.803 - 10.8012) * 1000 * M);
});

test('where the driver said it had ended, it ends', () => {
  const s = sign({ marks: [{ kind: 'ended', at: [LON + 0.0001, 10.804] }] });
  near(stretchEnd(walk, s, { pieces, law: 60 }).end, (10.804 - 10.8012) * 1000 * M);
});

test('where the driver said it still applied, it runs on to the next junction after that', () => {
  const s = sign({ marks: [{ kind: 'still', at: pt(10.806) }] });
  near(stretchEnd(walk, s, { pieces, law: 60 }).end, (10.815 - 10.8012) * 1000 * M);
  // Told later that it had ended before there after all, the older answer is dropped and
  // the first crossing ends it again.
  const t = sign({ marks: [{ kind: 'still', at: pt(10.806) }, { kind: 'ended', at: pt(10.8058) }] });
  near(stretchEnd(walk, t, { pieces, law: 60 }).end, (10.805 - 10.8012) * 1000 * M);
});

test('the next taught sign ends the one before it', () => {
  const next = sign({ id: 2, at: [LON + 0.0001, 10.804], max: 40 });
  near(stretchEnd(walk, sign(), { pieces, law: 60, signs: [sign(), next] }).end, (10.804 - 10.8012) * 1000 * M);
  const facingAway = sign({ id: 3, at: [LON + 0.0001, 10.804], heading: 180 });
  near(stretchEnd(walk, sign(), { pieces, law: 60, signs: [facingAway] }).end, (10.805 - 10.8012) * 1000 * M);
});

test('with nothing to end it within reach, the stretch is open', () => {
  const s = sign({ marks: [{ kind: 'still', at: pt(10.816) }] });
  assert.deepEqual(stretchEnd(walk, s, { pieces, law: 60 }), { end: REACH, open: true, why: 'open' });
});

test('what ended a stretch is said, so the driver can be told where it stops', () => {
  assert.equal(stretchEnd(walk, sign(), { pieces, law: 60 }).why, 'junction');
  assert.equal(stretchEnd(walk, sign({ marks: [{ kind: 'ended', at: [LON + 0.0001, 10.804] }] }), { pieces, law: 60 }).why, 'mark');
  const next = sign({ id: 2, at: [LON + 0.0001, 10.804], max: 40 });
  assert.equal(stretchEnd(walk, sign(), { pieces, law: 60, signs: [sign(), next] }).why, 'sign');
});

test('parked, a taught sign reaches from its foot to the road that ends it, named', () => {
  const r = reachOf(sign(), pieces, { lawOf: () => 60 });
  near(r.end, (10.805 - 10.801) * 1000 * M);
  assert.equal(r.open, false);
  assert.equal(r.cross.id, 3, 'the tertiary street, not the hẻm before it');
  assert.equal(r.piece, road1);
  // Above the law, the hẻm ends it - and it is still named as the road met.
  const over = reachOf(sign({ max: 80 }), pieces, { lawOf: () => 60 });
  near(over.end, (10.803 - 10.801) * 1000 * M);
  assert.equal(over.cross.id, 2);
  assert.equal(reachOf(sign({ at: [LON + 0.01, 10.801] }), pieces), null, 'off the map');
});

test('the car stays on the stretch until it turns off or reaches the end', () => {
  const st = { walk, end: 400, s: 0 };
  near(onStretch(st, pt(10.8027)), (10.8027 - 10.8012) * 1000 * M);
  assert.equal(onStretch(st, [LON + 0.0006, 10.8027]), null, 'turned off');
  assert.equal(onStretch({ ...st, s: 350 }, pt(10.8052)), null, 'past the end');
});

test('along places a point only within the stretch asked about', () => {
  near(along(walk, pt(10.803)).s, (10.803 - 10.8012) * 1000 * M);
  const far = along(walk, pt(10.803), 1000, 1200);
  assert.ok(far.s > 900 && far.off > 700, 'held to the stretch asked about, and far off it');
});

// A drive that comes north and turns east into a bend, tapping Sai halfway round.
const bend = [[LON, 10.8], [LON, 10.8005], [LON, 10.801], [LON + 0.0005, 10.8015], [LON + 0.001, 10.8015]];

test('the heading at a sign is the road\'s there, not the car\'s at the tap', () => {
  assert.equal(headingAt(bend, [LON + 0.00005, 10.8007], 90), 0);
  assert.equal(headingAt(bend, [LON + 0.0008, 10.80152], 0), 90);
  assert.equal(headingAt([], pt(10.8), 45), 45);
});

const report = (over = {}) => ({
  id: 7, t: '2026-09-27T02:00:00Z', lon: LON + 0.001, lat: 10.8015, heading: 90,
  window: bend.slice(0, 4).map(([lon, lat]) => ({ lon, lat })), ...over,
});

test('a number the app did not say teaches a sign, facing the way the road ran there', () => {
  const r = report({ answer: 30, cause: 'sign', signAt: { lon: LON, lat: 10.8007 } });
  assert.deepEqual(lessonFrom(r), { id: 7, t: r.t, kind: 'sign', at: [LON, 10.8007], heading: 0, max: 30, placed: true });
  const tapped = lessonFrom(report({ answer: 30, cause: 'sign' }));
  assert.deepEqual([tapped.at, tapped.placed], [[LON + 0.001, 10.8015], false]);
});

test('a number explained by the zone or the map is still a sign someone read', () => {
  assert.equal(lessonFrom(report({ answer: 50, cause: 'zone' })).kind, 'sign');
  assert.equal(lessonFrom(report({ answer: 60, cause: 'mapsign' })).kind, 'sign');
});

test('nothing to learn from no sign, not remembering, or the app being right', () => {
  for (const [answer, cause] of [['none', 'none'], ['unsure', 'unsure'], [60, 'lag'], [60, 'same'], [undefined, undefined]]) {
    assert.equal(lessonFrom(report({ answer, cause })), null, `${answer}/${cause}`);
  }
});

test('under a taught sign, the answer moves or removes it', () => {
  const taught = { id: 1, max: 30, s: 400 };
  assert.deepEqual(lessonFrom(report({ answer: 'none', cause: 'gone', taught })), { id: 7, t: '2026-09-27T02:00:00Z', kind: 'gone', sign: 1 });
  const ended = lessonFrom(report({ answer: 60, cause: 'ended', taught, signAt: { lon: LON, lat: 10.8007 } }));
  assert.deepEqual([ended.kind, ended.sign, ended.at], ['ended', 1, [LON, 10.8007]]);
  assert.equal(lessonFrom(report({ answer: 40, cause: 'sign', taught })).kind, 'sign');
  const still = lessonFrom(report({ answer: 30, cause: 'still', left: { id: 1, max: 30 } }));
  assert.deepEqual([still.kind, still.sign, still.at], ['still', 1, [LON + 0.001, 10.8015]]);
});

test('a reviewed answer is dated when it was given', () => {
  assert.equal(lessonFrom(report({ answer: 30, cause: 'sign', reviewedAt: '2026-09-27T05:00:00Z' })).t, '2026-09-27T05:00:00Z');
});

test('the signs ahead follow a taught stretch, not the pieces under it', () => {
  const judge = () => ({ key: '60|theo_luat', max: 60 });
  const value = { key: '30|nguoi_bao', max: 30 };
  const out = limitsAhead(walk, judge, judge(), undefined, [{ from: 103.4, to: 298.2, value }]);
  assert.deepEqual(out.map((l) => [l.dist, l.value.max]), [[103.4, 30], [298.2, 60]]);
  // The same sign seen from 2 m further on stands on the same spot: the HUD knows a sign by
  // where it stands, and one that moved with every fix was drawn again each time.
  const moved = 0.02 * M; // 0.00002° further north
  const later = walkAhead(pieces, { piece: road1, seg: 1, t: 0.22 }, 0, REACH, pt(10.80122));
  const again = limitsAhead(later, judge, judge(), undefined, [{ from: 103.4 - moved, to: 298.2 - moved, value }]);
  assert.deepEqual(again.map((l) => l.at.map((x) => x.toFixed(5))), out.map((l) => l.at.map((x) => x.toFixed(5))));
  // Without it, nothing changes on this road.
  assert.deepEqual(limitsAhead(walk, judge, judge()), []);
});

test('the taught signs along the road ahead, nearest first, only those facing the car', () => {
  const a = sign({ id: 2, at: [LON + 0.0001, 10.806] }), b = sign({ id: 3, at: [LON + 0.0001, 10.803] });
  const away = sign({ id: 4, at: [LON + 0.0001, 10.804], heading: 180 }), behind = sign({ id: 5, at: [LON + 0.0001, 10.8005] });
  assert.deepEqual(signsOn(walk, [a, b, away, behind]).map((x) => x.sign.id), [3, 2]);
});
