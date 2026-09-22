import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeView, toCamera } from './view.js';

const view = makeView({ width: 390, height: 700 });

test('the car sits at its fixed point, full size', () => {
  const [x, y, f] = view.project(0, 0);
  assert.equal(x, 195);
  assert.equal(y, view.yCar);
  assert.equal(f, 1);
});

test('further ahead is higher up and smaller, and never reaches the horizon', () => {
  let last = view.project(0, 0);
  for (const z of [10, 50, 100, 300, 600, 1500, 10000]) {
    const p = view.project(0, z);
    assert.ok(p[1] < last[1] && p[2] < last[2], `z=${z}`);
    assert.ok(p[1] > view.yHor, `z=${z}`);
    last = p;
  }
});

test('a 12 m road 500 m ahead is still wide enough to see', () => {
  const [l] = view.project(-6, 500), [r] = view.project(6, 500);
  assert.ok(r - l > 18, `${(r - l).toFixed(1)} px`);
});

test('behind the car is drawn below it, down to a limit', () => {
  assert.ok(view.project(0, -10)[1] > view.yCar);
  assert.equal(view.project(0, -500)[1], view.project(0, view.near)[1]);
});

test('camera space: ahead is +z, right is +x, whichever way the car faces', () => {
  const north = { x: 0, y: 0, bearing: 0 };
  assert.deepEqual(toCamera(north, 0, 10).map((n) => Math.round(n) + 0), [0, 10]);
  assert.deepEqual(toCamera(north, 10, 0).map((n) => Math.round(n) + 0), [10, 0]);
  const east = { x: 0, y: 0, bearing: 90 };
  assert.deepEqual(toCamera(east, 10, 0).map((n) => Math.round(n) + 0), [0, 10]);
  assert.deepEqual(toCamera(east, 0, -10).map((n) => Math.round(n) + 0), [10, 0]); // south is on the right
});
