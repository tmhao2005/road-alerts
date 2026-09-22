import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTwoFingers, twistOf, flick } from './gesture.js';

test('too early to tell until the fingers have really moved', () => {
  assert.equal(readTwoFingers([100, 400], [250, 400], [103, 404], [252, 405]), null);
});

test('two fingers side by side sliding up together tilt', () => {
  assert.equal(readTwoFingers([100, 400], [250, 410], [102, 370], [251, 378]), 'tilt');
  assert.equal(readTwoFingers([100, 400], [250, 410], [99, 440], [252, 452]), 'tilt');
});

test('fingers spreading apart pinch, even if they drift upward', () => {
  assert.equal(readTwoFingers([150, 400], [230, 400], [110, 385], [270, 385]), 'pinch');
});

test('one finger above the other moving together is a drag, not a tilt', () => {
  assert.equal(readTwoFingers([180, 300], [200, 480], [180, 270], [200, 450]), 'pinch');
});

test('fingers moving opposite ways vertically pinch', () => {
  assert.equal(readTwoFingers([100, 400], [250, 400], [100, 380], [250, 420]), 'pinch');
});

test('twist is measured either way round, across the ±180 seam', () => {
  assert.ok(Math.abs(twistOf([0, 0], [100, 0], [0, 0], [0, 100]) - 90) < 1e-9);
  assert.ok(Math.abs(twistOf([0, 0], [100, 0], [0, 0], [0, -100]) + 90) < 1e-9);
  assert.ok(Math.abs(twistOf([0, 0], [-100, 1], [0, 0], [-100, -1]) - 1.146) < 0.01);
});

test('a flick carries its speed; a finger that stopped first does not', () => {
  const trail = [[0, 100, 500], [16, 120, 500], [32, 140, 500], [48, 160, 500]];
  const f = flick(trail, 50);
  assert.ok(Math.abs(f.v[0] - 1250) < 1 && f.v[1] === 0 && f.zoom === 0);
  assert.deepEqual(flick(trail, 150).v, [0, 0]);
  assert.deepEqual(flick([[40, 100, 500]], 50).v, [0, 0]);
});

test('a pinch flick carries its zoom rate', () => {
  const f = flick([[0, 200, 400, 100], [50, 200, 400, 150], [100, 200, 400, 200]], 100);
  assert.ok(Math.abs(f.zoom - Math.log(2) / 0.1) < 1e-9);
});
