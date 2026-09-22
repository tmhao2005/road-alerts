// Where a point on the road lands on the screen.
//
// A true perspective camera shrinks a junction 500 m ahead to a few pixels, which is
// useless at a glance. So distance ahead is folded first (logarithmically, past `fold`
// metres) and the folded ground plane is then drawn in ordinary perspective. Near the car
// the view is honest; far away it is compressed, but the order of things along the road
// never changes, and nothing ever reaches the horizon.
//
// Pure: no imports, so it runs under `node --test` and in the browser.

// Camera space: x metres to the right of the car, z metres ahead of it.
// cam: { x, y, bearing } in local metres (x east, y north), bearing in compass degrees.
export function toCamera(cam, px, py) {
  const b = (cam.bearing * Math.PI) / 180;
  const s = Math.sin(b), c = Math.cos(b);
  const dx = px - cam.x, dy = py - cam.y;
  return [dx * c - dy * s, dx * s + dy * c];
}

// width, height: the drawing area in CSS px.
// carX, carY, horizonY: where the car and the vanishing line sit, as fractions of the
// width and height.
// depth: metres over which the ground halves in size; smaller looks more top-down.
// fold: metres ahead beyond which distance is compressed.
// scale: pixels per metre across the road at the car, for a 390 px wide screen.
export function makeView({ width, height, carX = 0.5, carY = 0.64, horizonY = 0.17, depth = 90, fold = 220, scale = 7 }) {
  const cx = width * carX;
  const yCar = height * carY, yHor = height * horizonY;
  const px = scale * (Math.min(width, height) / 390);
  const near = -0.6 * depth;

  const folded = (z) => (z > 0 ? fold * Math.log(1 + z / fold) : z);
  const factor = (z) => depth / (folded(Math.max(z, near)) + depth);

  return {
    width, height, cx, yCar, yHor, px, near,
    factor,
    // Screen position of a ground point, and how much it has shrunk there (1 at the car).
    project(x, z) {
      const f = factor(z);
      return [cx + x * px * f, yHor + (yCar - yHor) * f, f];
    },
  };
}
