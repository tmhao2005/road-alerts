import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statutoryLimit, withSign, column } from './limit.js';

const twoWay = { divided: false, oneway: false, lanes: 2 };
const divided = { divided: true, oneway: true, lanes: 2 };

test('Bảng 1: inside đông dân cư, every Bảng-2 vehicle gets the same two numbers', () => {
  for (const v of ['oto_con', 'oto_lon', 'xe_mo_to', 'xe_buyt', 'keo_ro_mooc']) {
    assert.equal(statutoryLimit(v, { ...divided, inside: true }).max, 60, v);
    assert.equal(statutoryLimit(v, { ...twoWay, inside: true }).max, 50, v);
  }
});

test('Bảng 2: outside đông dân cư, each row, both columns', () => {
  const rows = { oto_con: [90, 80], oto_lon: [80, 70], xe_mo_to: [70, 60], xe_buyt: [70, 60], keo_ro_mooc: [60, 50] };
  for (const [v, [wide, narrow]] of Object.entries(rows)) {
    assert.equal(statutoryLimit(v, { ...divided, inside: false }).max, wide, `${v} wide`);
    assert.equal(statutoryLimit(v, { ...twoWay, inside: false }).max, narrow, `${v} narrow`);
  }
});

test('a four-lane two-way undivided road still takes the narrow column', () => {
  const r = statutoryLimit('oto_con', { divided: false, oneway: false, lanes: 4, inside: false });
  assert.equal(r.max, 80);
  assert.match(r.rule, /cột 2/);
});

test('one-way roads: lane count decides the column, unknown falls to the lower one', () => {
  assert.equal(column({ oneway: true, lanes: 2 }).wide, true);
  assert.equal(column({ oneway: true, lanes: 1 }).wide, false);
  assert.equal(column({ oneway: true, lanes: null }).wide, false);
  assert.equal(statutoryLimit('oto_con', { oneway: true, lanes: 3, inside: true }).max, 60);
});

test('xe gắn máy and xe mô tô are different vehicles, 30 km/h apart outside town', () => {
  const road = { ...divided, inside: false };
  assert.equal(statutoryLimit('xe_gan_may', road).max, 40);
  assert.equal(statutoryLimit('xe_mo_to', road).max, 70);
});

test('Điều 7 and 8 caps apply inside and outside đông dân cư alike', () => {
  for (const inside of [true, false]) {
    assert.equal(statutoryLimit('xe_gan_may', { ...twoWay, inside }).max, 40);
    assert.equal(statutoryLimit('xe_may_chuyen_dung', { ...twoWay, inside }).max, 40);
    assert.equal(statutoryLimit('xe_4b_cho_nguoi', { ...twoWay, inside }).max, 30);
    assert.equal(statutoryLimit('xe_4b_cho_hang', { ...twoWay, inside }).max, 50);
  }
});

test('cao tốc: the statute only bounds it, so no number is invented', () => {
  const r = statutoryLimit('oto_con', { expressway: true });
  assert.equal(r.max, null);
  assert.deepEqual(r.range, [60, 120]);
  assert.equal(r.min, 60);
  assert.equal(r.rule, 'Điều 9');
});

test('a posted sign overrides the statutory default', () => {
  const s = statutoryLimit('oto_con', { ...twoWay, inside: true });
  const r = withSign('oto_con', s, 60);
  assert.equal(r.max, 60);
  assert.equal(r.tier, 'bien_bao');
  assert.equal(r.statutoryMax, 50);
});

test('a sign never lifts a capped vehicle above its own ceiling', () => {
  const s = statutoryLimit('xe_gan_may', { ...twoWay, inside: false });
  const r = withSign('xe_gan_may', s, 60);
  assert.equal(r.max, 40);
  assert.ok(r.notes.some((n) => n.includes('Điều 7')));
});

test('tiers: statute when there is no sign, unknown when there is no number at all', () => {
  assert.equal(withSign('oto_con', statutoryLimit('oto_con', { ...twoWay, inside: true }), null).tier, 'theo_luat');
  assert.equal(withSign('oto_con', statutoryLimit('oto_con', { expressway: true }), null).tier, 'khong_ro');
  assert.equal(withSign('oto_con', statutoryLimit('oto_con', { expressway: true }), 100).max, 100);
});

test('an unknown vehicle is an error, not a silent default', () => {
  assert.throws(() => statutoryLimit('xe_dap', twoWay), /unknown vehicle/);
});
