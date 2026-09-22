import { test } from 'node:test';
import assert from 'node:assert/strict';
import { travel } from './oneway.js';

test('a two-way street goes either way', () => {
  assert.equal(travel({ highway: 'residential' }), 0);
  assert.equal(travel({ highway: 'primary', oneway: 'no' }), 0);
});

test('one-way along or against the way it is drawn', () => {
  for (const oneway of ['yes', '1', 'true']) assert.equal(travel({ highway: 'secondary', oneway }), 1);
  assert.equal(travel({ highway: 'secondary', oneway: '-1' }), -1);
});

test('roundabouts and motorways are one-way without saying so', () => {
  assert.equal(travel({ highway: 'tertiary', junction: 'roundabout' }), 1);
  assert.equal(travel({ highway: 'motorway' }), 1);
  assert.equal(travel({ highway: 'motorway_link' }), 1);
});

test('a street one-way for cars only is two-way for xe máy', () => {
  const street = { highway: 'secondary', name: 'Phạm Ngũ Lão', oneway: 'yes', onewayMoto: 'no' };
  assert.equal(travel(street), 1);
  assert.equal(travel(street, false), 1);
  assert.equal(travel(street, true), 0);
});

test('a one-way rule of their own binds xe máy, and only them', () => {
  const street = { highway: 'residential', onewayMoto: '-1' };
  assert.equal(travel(street, true), -1);
  assert.equal(travel(street, false), 0);
});
