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

test('unproject finds the ground point a finger is on', () => {
  for (const [x, z] of [[0, 0], [5, 20], [-8, 120], [30, 600], [3, -10]]) {
    const [sx, sy] = view.project(x, z);
    const [x2, z2] = view.unproject(sx, sy);
    assert.ok(Math.abs(x2 - x) < 0.01 && Math.abs(z2 - z) < 0.01, `${x},${z} -> ${x2.toFixed(3)},${z2.toFixed(3)}`);
  }
});

test('above the horizon there is no ground: the far edge is used instead', () => {
  const [, z] = view.unproject(195, view.yHor - 50);
  assert.ok(Number.isFinite(z) && z > 1000);
});
