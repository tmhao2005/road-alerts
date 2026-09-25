import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMotion } from './motion.js';
import { metres } from './geo.js';

// A straight road north, 1 km long, starting at `from` metres along it.
const LON = 106.7, LAT = 10.7, DEG = 1 / 111195; // ~1 m of latitude
const road = (from = 0) => [[LON, LAT + from * DEG], [LON, LAT + 1000 * DEG]];
const north = (p) => (p.lat - LAT) / DEG;

test('between fixes the car keeps moving at its speed', () => {
  const mo = makeMotion();
  mo.fix(0, road(0), 10);
  assert.ok(Math.abs(north(mo.at(0.5)) - 5) < 0.2);
  assert.ok(Math.abs(north(mo.at(1.0)) - 10) < 0.2);
});

test('with no new fix it stops guessing after a moment', () => {
  const mo = makeMotion({ ahead: 1.5 });
  mo.fix(0, road(0), 10);
  assert.ok(Math.abs(north(mo.at(5)) - 15) < 0.2);
});

test('it never runs past the end of the walked road', () => {
  const mo = makeMotion();
  mo.fix(0, [[LON, LAT], [LON, LAT + 8 * DEG]], 10);
  assert.ok(north(mo.at(1.2)) <= 8.01);
});

test('a fix that disagrees is eased in, not jumped to', () => {
  const mo = makeMotion();
  mo.fix(0, road(0), 10);
  mo.at(1);
  mo.fix(1, road(16), 10); // the guess said 10 m, GPS says 16 m
  const right = north(mo.at(1));
  assert.ok(Math.abs(right - 10) < 0.2, 'no jump at the moment of the fix');
  const later = north(mo.at(2.5)) - 15; // 1.5 s of travel from 16 m
  assert.ok(Math.abs(later - 16) < 0.5, `${later.toFixed(2)}`);
});

// On screen, the car's speed over one frame either side of a moment.
const pace = (mo, t, h = 1 / 30) => (north(mo.at(t + h)) - north(mo.at(t))) / h;

test('a fix that disagrees does not change the car\'s speed in a single frame', () => {
  const mo = makeMotion();
  mo.fix(0, road(0), 10);
  const before = pace(mo, 1 - 1 / 30);
  mo.fix(1, road(12), 10); // GPS is 2 m ahead of the guess
  const after = pace(mo, 1);
  assert.ok(Math.abs(after - before) < 1, `${before.toFixed(1)} -> ${after.toFixed(1)} m/s`);
});

test('told where to stop, the car slows into that point and never passes it', () => {
  const mo = makeMotion();
  mo.fix(0, road(0), 10, 6);
  assert.ok(pace(mo, 0) > 8, 'leaves at its own speed');
  assert.ok(north(mo.at(1.5)) <= 6.01);
  assert.ok(north(mo.at(1.5)) > 5);
});

test('a big jump is taken at once rather than slid across the map', () => {
  const mo = makeMotion({ snap: 80 });
  mo.fix(0, road(0), 10);
  mo.fix(1, road(400), 10);
  assert.ok(Math.abs(north(mo.at(1)) - 400) < 0.2);
});

test('standing still, GPS wander does not move the car', () => {
  const mo = makeMotion();
  mo.fix(0, road(100), 0);
  const a = mo.at(0.5);
  mo.fix(1, road(104), 0.3);
  const b = mo.at(1.5);
  assert.ok(metres([a.lon, a.lat], [b.lon, b.lat]) < 0.01);
});

test('the view turns toward a new direction smoothly', () => {
  const mo = makeMotion({ turn: 0.35 });
  mo.fix(0, [[LON, LAT], [LON, LAT + 100 * DEG]], 10);
  assert.ok(Math.abs(mo.at(0).bearing) < 1);
  mo.fix(0.1, [[LON, LAT + 1 * DEG], [LON + 100 * DEG, LAT + 1 * DEG]], 10); // now heading east
  const soon = mo.at(0.2).bearing;
  assert.ok(soon > 5 && soon < 60, `${soon.toFixed(1)}`);
  let b;
  for (let t = 0.3; t < 3; t += 0.05) b = mo.at(t).bearing;
  assert.ok(Math.abs(b - 90) < 2, `${b.toFixed(1)}`);
});
