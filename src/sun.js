// Whether the sun is up at a place and moment, for a screen that is light by day and dark
// at night whatever the phone is set to. A phone left in dark mode all year would otherwise
// show the night map at noon, when the glare on a windscreen mount is worst.
//
// The sunrise equation with the usual corrections, good to a minute or two, which is far
// finer than anyone can tell the moment dusk turns a screen from light to dark.

const RAD = Math.PI / 180;
const J2000 = 2451545;

// ms: a time as Date.now(); lat, lon in degrees, east positive.
// Returns { rise, set } in ms for the solar day nearest to ms.
export function sunTimes(ms, lat, lon) {
  const jd = ms / 864e5 + 2440587.5;
  // The mean solar noon nearest to ms.
  const noon = Math.round(jd - J2000 - 0.0009 + lon / 360) - lon / 360 + 0.0009;
  const m = (357.5291 + 0.98560028 * noon) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const ecl = (m + c + 180 + 102.9372) % 360;
  const transit = J2000 + noon + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * ecl * RAD);
  const dec = Math.asin(Math.sin(ecl * RAD) * Math.sin(23.4397 * RAD));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
  const half = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD / 360;
  const toMs = (j) => (j - 2440587.5) * 864e5;
  return { rise: toMs(transit - half), set: toMs(transit + half) };
}

export function daylight(ms, lat, lon) {
  const { rise, set } = sunTimes(ms, lat, lon);
  return ms >= rise && ms < set;
}
