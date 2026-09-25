import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStillness, lastChange, pending, retain, distance, similarStretches, whenLabel, stood, KEEP_TRACES } from './trip.js';

const MIN = 60e3;
const at = (t, lon = 106.7, lat = 10.8, kmh = 0) => ({ t, lon, lat, kmh });

test('a trip ends after five minutes without going anywhere', () => {
  const still = makeStillness();
  assert.equal(still(at(0)).ended, false);
  assert.equal(still(at(4 * MIN)).ended, false);
  assert.deepEqual(still(at(5 * MIN)), { still: true, ended: true });
  // Said once, not on every fix after.
  assert.deepEqual(still(at(6 * MIN)), { still: true, ended: false });
});

test('a red light, or creeping in a jam, is not the end of a trip', () => {
  const still = makeStillness();
  still(at(0));
  still(at(2 * MIN));
  still(at(2 * MIN + 1000, 106.7, 10.8, 25)); // pulled away
  assert.equal(still(at(6 * MIN)).ended, false);

  const jam = makeStillness();
  // 2 km/h, but 60 m further on each minute.
  for (let i = 0; i <= 8; i++) assert.equal(jam(at(i * MIN, 106.7 + i * 0.00055, 10.8, 2)).ended, false);
});

test('GPS wobble while parked does not restart the clock', () => {
  const still = makeStillness();
  still(at(0));
  still(at(2 * MIN, 106.70012, 10.80008)); // ~15 m
  assert.equal(still(at(5 * MIN, 106.69995, 10.79992)).ended, true);
});

test('the mistake most likely began where the number last changed', () => {
  const w = [50, 50, 60, 60, 50, 50, 50].map((shown, i) => ({ t: i, shown }));
  assert.equal(lastChange(w), 4);
  assert.equal(lastChange([{ shown: 50 }, { shown: 50 }]), 0);
  assert.equal(lastChange([]), 0);
});

test('pending: unanswered and less than a week old, newest first', () => {
  const now = Date.parse('2026-09-24T10:00:00Z');
  const r = (t, extra = {}) => ({ t, ...extra });
  const list = pending([
    r('2026-09-24T01:00:00Z'),
    r('2026-09-24T02:00:00Z'),
    r('2026-09-23T01:00:00Z', { reviewedAt: '2026-09-23T02:00:00Z' }),
    r('2026-09-10T01:00:00Z'),
  ], now);
  assert.deepEqual(list.map((x) => x.t), ['2026-09-24T02:00:00Z', '2026-09-24T01:00:00Z']);
});

test('reports are kept until sent and a week has passed; traces for the newest trips', () => {
  const now = Date.parse('2026-09-24T10:00:00Z');
  const reports = [
    { id: 1, t: '2026-08-01T00:00:00Z' },                                    // old, never sent: kept
    { id: 2, t: '2026-09-01T00:00:00Z', sentAt: '2026-09-02T00:00:00Z' },    // sent long ago: dropped
    { id: 3, t: '2026-09-20T00:00:00Z', sentAt: '2026-09-21T00:00:00Z' },    // sent recently: kept
  ];
  const trips = Array.from({ length: KEEP_TRACES + 2 }, (_, i) => ({ id: 1000 + i }));
  const kept = retain(reports, trips, now);
  assert.deepEqual(kept.reports.map((r) => r.id), [1, 3]);
  assert.equal(kept.trips.length, KEEP_TRACES);
  assert.deepEqual(kept.dropped, [1001, 1000]);
});

test('distance skips gaps instead of drawing a straight line across them', () => {
  const e = (t, lon) => ({ t: new Date(t).toISOString(), lon, lat: 10.8 });
  const d = distance([e(0, 106.7), e(5000, 106.701), e(600e3, 106.8), e(605e3, 106.801)]);
  assert.ok(Math.abs(d - 2 * 109.5) < 2, `got ${d}`);
});

test('the same zone reason elsewhere on the trip, grouped into stretches', () => {
  const report = { lat: 10.8, lon: 106.7, road: 'QL.13', zone: { reason: 'Xã, có nhà dọc đường' }, shown: { max: 50, rule: 'Bảng 1, cột 2' } };
  const e = (s, lon, reason = report.zone.reason, max = 50, road = 'QL.13') => ({
    type: 'trace', t: new Date(s * 1000).toISOString(), lat: 10.8, lon, road, ward: 'Xã Bàu Bàng',
    zone: { reason }, shown: { max, rule: 'Bảng 1, cột 2' },
  });
  const trace = [
    e(0, 106.7),                  // the report itself: too close
    e(100, 106.71), e(105, 106.7105), e(110, 106.711),   // one stretch
    e(115, 106.712, 'Trong phường (nội thành)'),          // a different rule breaks it
    e(200, 106.72), e(205, 106.7205),                     // a second stretch
    e(300, 106.73, report.zone.reason, 60),               // same reason, different number
  ];
  const zone = similarStretches(trace, report, 'zone');
  assert.equal(zone.length, 2);
  assert.equal(zone[0].points, 3);
  assert.equal(zone[1].points, 2);
  assert.deepEqual(similarStretches(trace, report, 'lag'), []);
});

test('a map defect is per road', () => {
  const report = { lat: 10.8, lon: 106.7, road: 'Nguyễn Văn Linh', zone: { reason: 'x' }, shown: { max: 50, rule: 'Bảng 1, cột 2' } };
  const e = (s, lon, road) => ({ type: 'trace', t: new Date(s * 1000).toISOString(), lat: 10.8, lon, road, zone: { reason: 'x' }, shown: { max: 50, rule: 'Bảng 1, cột 2' } });
  const found = similarStretches([e(0, 106.72, 'Nguyễn Văn Linh'), e(60, 106.73, 'Nguyễn Hữu Thọ')], report, 'column');
  assert.deepEqual(found.map((s) => s.road), ['Nguyễn Văn Linh']);
});

test('when, the way people say it, in Vietnam time', () => {
  const now = Date.parse('2026-09-24T10:00:00Z'); // 17:00 in Vietnam
  assert.equal(whenLabel('2026-09-24T01:07:00Z', now), 'sáng nay');
  assert.equal(whenLabel('2026-09-24T07:30:00Z', now), 'chiều nay');
  assert.equal(whenLabel('2026-09-23T12:00:00Z', now), 'tối hôm qua');
  // 23:30 UTC on the 23rd is 06:30 on the 24th in Vietnam.
  assert.equal(whenLabel('2026-09-23T23:30:00Z', now), 'sáng nay');
  assert.equal(whenLabel('2026-09-21T02:00:00Z', now), 'sáng 21/9');
});

test('opened on a parked car and closed again, a trip never went anywhere', () => {
  // Five minutes of GPS wander around one spot, and a start entry with no position.
  const wander = [{ type: 'start' }, ...Array.from({ length: 60 }, (_, i) => at(i * 5000, 106.7 + (i % 3) * 0.00005, 10.8 + (i % 2) * 0.00005, i % 4))];
  assert.equal(stood(wander), true);
  assert.equal(stood([{ type: 'start' }]), true, 'no position at all');
});

test('a trip that reached driving speed, or left the spot, went somewhere', () => {
  assert.equal(stood([at(0), at(5000, 106.7, 10.8, 12)]), false);
  assert.equal(stood([at(0), at(5000, 106.7, 10.8006)]), false, '~67 m on at a crawl');
});
