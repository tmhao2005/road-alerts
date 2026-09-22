import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeView, toCamera, fromCamera, follow, pitchFor, ZOOM } from './view.js';

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

test('the driving view is exactly the folded perspective it always was', () => {
  // The formula the view had before the camera could move, as the reference.
  const W = 390, H = 700, depth = 90, fold = 220, px = 7, cx = W / 2, yCar = H * 0.64, yHor = H * 0.17;
  const folded = (z) => (z > 0 ? fold * Math.log(1 + z / fold) : z);
  const old = (x, z) => {
    const f = depth / (folded(Math.max(z, -0.6 * depth)) + depth);
    return [cx + x * px * f, yHor + (yCar - yHor) * f];
  };
  for (const [x, z] of [[0, 0], [4, 12], [-7, 60], [20, 250], [-3, 800], [2, -20], [9, -300]]) {
    const [sx, sy] = view.project(x, z), [ox, oy] = old(x, z);
    assert.ok(Math.abs(sx - ox) < 1e-9 && Math.abs(sy - oy) < 1e-9, `${x},${z}`);
  }
});

test('zooming out lifts the camera and tips it toward straight down', () => {
  const drive = view.drive;
  assert.equal(pitchFor(1, drive), drive);
  assert.equal(pitchFor(2.5, drive), drive);
  let last = drive;
  for (const zoom of [0.9, 0.7, 0.5, 0.3, 0.2, 0.15]) {
    const p = makeView({ width: 390, height: 700, zoom }).pitch;
    assert.ok(p < last, `zoom ${zoom}: ${p.toFixed(1)}`);
    last = p;
  }
  assert.equal(makeView({ width: 390, height: 700, zoom: ZOOM.min }).pitch, 0);
});

test('zoomed out, the screen is all street: the sky is gone and the view reaches further', () => {
  assert.ok(view.yHor > 0 && view.far === Infinity);
  const out = makeView({ width: 390, height: 700, zoom: 0.4 });
  assert.ok(out.yHor < 0, `horizon at ${out.yHor.toFixed(0)}`);
  assert.ok(out.far > 300 && Number.isFinite(out.far), `${out.far.toFixed(0)} m`);
  // And a side street 100 m away comes on screen, where the driving view has it off the edge.
  const wide = makeView({ width: 390, height: 700, zoom: 0.2 });
  assert.ok(view.project(100, 0)[0] > 390);
  assert.ok(wide.project(100, 0)[0] < 390);
});

test('from straight above, the map is a plan: a square block is drawn square', () => {
  const top = makeView({ width: 390, height: 700, zoom: ZOOM.min });
  const [l, b] = top.project(-200, -200), [r, t] = top.project(200, 200);
  assert.ok(Math.abs((r - l) - (b - t)) < 1e-6);
  assert.ok(Math.abs(top.project(0, 800)[2] - 1) < 1e-12, 'nothing shrinks with distance');
});

test('unproject finds the ground under a finger at every zoom and tilt', () => {
  for (const [zoom, tilt] of [[1, 0], [0.5, 0], [0.2, 10], [ZOOM.min, 0], [ZOOM.min, 30], [2, -15], [1, 20]]) {
    const v = makeView({ width: 390, height: 700, zoom, tilt });
    for (const [x, z] of [[0, 0], [30, 90], [-60, 250], [10, -40]]) {
      const [sx, sy] = v.project(x, z);
      if (sy < 0 || sy > 700) continue;
      const [x2, z2] = v.unproject(sx, sy);
      assert.ok(Math.abs(x2 - x) < 0.01 && Math.abs(z2 - z) < 0.01, `zoom ${zoom} tilt ${tilt}: ${x},${z} -> ${x2.toFixed(3)},${z2.toFixed(3)}`);
    }
  }
});

test('tilting by hand stops at straight down and at the limit', () => {
  assert.equal(makeView({ width: 390, height: 700, tilt: -200 }).pitch, 0);
  assert.equal(makeView({ width: 390, height: 700, tilt: 200 }).pitch, 72);
});

test('fromCamera undoes toCamera', () => {
  const cam = { x: 12, y: -40, bearing: 137 };
  const [x, z] = toCamera(cam, 55, 20);
  const [px, py] = fromCamera(cam, x, z);
  assert.ok(Math.abs(px - 55) < 1e-9 && Math.abs(py - 20) < 1e-9);
});

test('a pinch keeps the ground under the fingers while it zooms and turns', () => {
  const viewFor = (zoom, tilt) => makeView({ width: 390, height: 700, zoom, tilt });
  const cam = { x: 0, y: 0, bearing: 30, zoom: 1, tilt: 0 };
  const a = [140, 380], b = [220, 430];
  const v0 = viewFor(cam.zoom, cam.tilt);
  const ground = fromCamera(cam, ...v0.unproject(...a));
  for (const change of [{ zoom: 0.5 }, { zoom: 0.25, turn: 40 }, { zoom: 1.8, turn: -15 }, { tilt: 12 }]) {
    const next = follow(viewFor, cam, a, b, change);
    const [sx, sy] = viewFor(next.zoom, next.tilt).project(...toCamera(next, ...ground));
    assert.ok(Math.hypot(sx - b[0], sy - b[1]) < 0.01, `${JSON.stringify(change)}: ${sx.toFixed(2)},${sy.toFixed(2)}`);
  }
});

test('a tilt past the limit is not banked for later', () => {
  const viewFor = (zoom, tilt) => makeView({ width: 390, height: 700, zoom, tilt });
  const next = follow(viewFor, { x: 0, y: 0, bearing: 0, zoom: 1, tilt: 0 }, [195, 448], [195, 448], { tilt: 300 });
  assert.equal(viewFor(1, next.tilt).pitch, 72);
  assert.ok(next.tilt < 30);
});
