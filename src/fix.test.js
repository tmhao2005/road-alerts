import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixFiller } from './fix.js';

const M = 1 / 111195; // ~1 m of latitude in degrees
const at = (north, t, extra = {}, east = 0) => ({ lon: 106.7 + east * M, lat: 10.7 + north * M, acc: 8, speed: null, heading: null, t: t * 1000, ...extra });

test('the first fix has nothing to work from', () => {
  const f = makeFixFiller()(at(0, 0));
  assert.equal(f.speed, null);
  assert.equal(f.heading, null);
  assert.equal(f.moved, 0);
});

test('a parked phone jumping ~11 m a second is still standing, facing nowhere', () => {
  const fill = makeFixFiller();
  fill(at(0, 0));
  for (let t = 1; t <= 10; t++) {
    const s = t % 2 ? 1 : -1;
    const f = fill(at(4 * s, t, {}, -4 * s));
    assert.equal(f.speed, 0, `t=${t}`);
    assert.equal(f.heading, null, `t=${t}`);
    assert.equal(f.moved, 0, `t=${t}`);
  }
});

test('driving off is recognised once the phone leaves its circle', () => {
  const fill = makeFixFiller({ circle: 15 });
  fill(at(0, 0));
  assert.equal(fill(at(10, 1)).speed, 0, '10 m could still be wobble');
  const f = fill(at(20, 2));
  assert.ok(Math.abs(f.speed - 10) < 0.1);
  assert.ok(f.heading < 1 || f.heading > 359);
  assert.equal(f.headingSrc, 'derived');
  const g = fill(at(32, 3));
  assert.ok(Math.abs(g.speed - 12) < 0.1, 'and keeps being moving while it goes on');
});

test('stopping is recognised where it happens', () => {
  const fill = makeFixFiller();
  fill(at(0, 0));
  fill(at(20, 1)); fill(at(40, 2)); fill(at(60, 3));
  // Stopped at ~60; the wobble goes back the way it came, which driving does not.
  const f = fill(at(54, 4));
  assert.equal(f.speed, 0);
  assert.equal(f.moved, 0);
  assert.equal(fill(at(62, 5)).speed, 0, 'and wobble round the new spot stays standing');
});

test("the phone's own speed and heading are kept as they are", () => {
  const fill = makeFixFiller();
  fill(at(0, 0));
  const f = fill(at(3, 1, { speed: 12, heading: 90 }));
  assert.equal(f.speed, 12);
  assert.equal(f.heading, 90);
  assert.equal(f.speedSrc, 'gps');
  assert.ok(Math.abs(f.moved - 3) < 0.1, 'a reported speed means the step is real travel');
});

test('a poor fix needs a bigger move before it counts', () => {
  const fill = makeFixFiller({ circle: 15 });
  fill(at(0, 0, { acc: 30 }));
  assert.equal(fill(at(40, 1, { acc: 30 })).speed, 0);
});
