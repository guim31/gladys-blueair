// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2.x never polls a device
// published with should_poll: false (and never polls the devices created
// without should_poll, GladysAssistant/Gladys#3198): the devices must be read
// by the hub's own timer, with no onPoll at all — at the configured interval,
// the sensor averages at most every 5 minutes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  FakeBlueair,
  createAll,
  createClock,
  createWorld,
  featureId,
} from './helpers/world.js';

/** Let the timer callback and the fake cloud settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const initials = (cloud) => cloud.requests.filter((r) => r.path.endsWith('/r/initial')).length;
const telemetries = (cloud) => cloud.requests.filter((r) => r.path.endsWith('/historical')).length;

test('the internal timer refreshes the states without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const cloud = new FakeBlueair({ devices: ['protect7470i'], now: clock.now });
  const w = await createWorld({
    clock,
    cloud,
    config: { ...CONFIG, poll_interval: '60' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);

  const device = w.fake.discoveredDevices[0];
  assert.equal(device.should_poll, false, 'Gladys is not asked to poll');
  assert.equal(device.poll_frequency, undefined);
  const uuid = cloud.uuid('protect7470i');
  const before = initials(cloud);
  const telemetryBefore = telemetries(cloud);

  for (const speed of [11, 37, 64, 91, 37]) {
    cloud.setState('protect7470i', 'fanspeed', speed);
    clock.advance(60_000);
    t.mock.timers.tick(60_000);
    await settle();
    assert.equal(w.fake.lastState(featureId(w, uuid, 'fan_speed')), speed);
  }
  assert.equal(initials(cloud) - before, 5, 'one reading per interval');
  assert.equal(telemetries(cloud) - telemetryBefore, 1, 'the 5-minute averages once in 5 minutes');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('the interval of the configuration is followed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const cloud = new FakeBlueair({ now: clock.now });
  const w = await createWorld({ clock, cloud, timers: true });
  t.after(() => w.app.stop());
  const before = initials(cloud);
  // Default: every 2 minutes.
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(initials(cloud), before);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(initials(cloud), before + 1);
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const cloud = new FakeBlueair({ now: clock.now });
  const w = await createWorld({ clock, cloud, timers: true });
  await w.app.stop();
  const before = cloud.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(cloud.requests.length, before);
});

test('onPoll, if Gladys ever calls it, reads the cloud too', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const before = initials(w.cloud);
  const ack = await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(ack.success, true);
  assert.equal(initials(w.cloud), before + 1);
});
