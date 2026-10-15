// -----------------------------------------------------------------------------
// scripts/probe.mjs, against the fake cloud: the made-up account is refused at
// every step, a real account is read without a write and without printing a
// secret, an id, a MAC address or a device name.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../scripts/probe.mjs';
import { EMAIL, FakeBlueair, PASSWORD, legacyClassic480i } from './helpers/fakeBlueair.js';

const NOW = Date.UTC(2025, 4, 17, 10, 0, 0);

test('made-up account: refused by Gigya, BlueCloud and the historical cloud', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  const lines = [];
  const ok = await probe({
    region: 'eu',
    request: cloud.request,
    print: (line) => lines.push(line),
    now: () => NOW,
  });
  assert.equal(ok, true, lines.join('\n'));
  assert.equal(lines.filter((line) => line.startsWith('OK')).length, 3, lines.join('\n'));
});

test('real account: read only, nothing sensitive printed', async () => {
  const device = legacyClassic480i();
  const cloud = new FakeBlueair({
    devices: ['max211i', 'protect7470i', 'sp4i'],
    legacyDevices: [device],
    now: () => NOW,
  });
  cloud.pendingRegistration = null;
  const lines = [];
  const ok = await probe({
    region: 'eu',
    username: EMAIL,
    password: PASSWORD,
    request: cloud.request,
    print: (line) => lines.push(line),
    now: () => NOW,
  });
  const text = lines.join('\n');
  assert.equal(ok, true, text);
  assert.match(text, /current cloud: logged in, 3 device\(s\)/);
  assert.match(text, /Blueair Protect 7470i/);
  assert.match(text, /historical cloud: 1 device\(s\)/);
  assert.deepEqual(cloud.commands, [], 'never a write');
  for (const secret of [
    EMAIL,
    PASSWORD,
    'Bedroom',
    'Office',
    device.listed.uuid,
    ...cloud.sessions,
  ]) {
    assert.ok(!text.includes(secret), `"${secret}" printed`);
  }
  for (const uuid of cloud.devices.keys()) {
    assert.ok(!text.includes(uuid), 'a device id printed');
  }
  assert.ok(!/([0-9a-f]{2}:){5}/i.test(text), 'a MAC address printed');
});

test('real account pending registration: reported, never completed by the probe', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  cloud.pendingRegistration = { firstName: 'Ada' };
  const lines = [];
  const ok = await probe({
    region: 'eu',
    username: EMAIL,
    password: PASSWORD,
    request: cloud.request,
    print: (line) => lines.push(line),
    now: () => NOW,
  });
  assert.equal(ok, false);
  assert.match(lines.join('\n'), /registration/);
  assert.equal(cloud.registrationCompleted, false);
});
