// -----------------------------------------------------------------------------
// The hub end to end, on the fake Gladys and the fake Blueair cloud: states,
// commands of every model family, the filter trigger, the refusals that stop
// the requests, the tokens kept under /data, the "Test the connection" report.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { legacyClassic480i } from './helpers/fakeBlueair.js';
import {
  CONFIG,
  FakeBlueair,
  createAll,
  createClock,
  createWorld,
  deviceId,
  discovered,
  featureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** Run a command on a feature as the Gladys dashboard would. */
async function set(w, uuid, key, value) {
  const device = discovered(w, uuid);
  const feature = device.features.find((f) => f.external_id === featureId(w, uuid, key));
  return w.fake.setValue(device, feature, value);
}

test('the states of the added devices are published, the others are not', async (t) => {
  const w = await world(t, { devices: ['max211i', 'protect7470i'] });
  assert.equal(w.fake.states.length, 0, 'nothing before the devices are added');
  const office = w.cloud.uuid('protect7470i');
  await w.fake.deviceCreated(discovered(w, office));
  assert.equal(w.fake.lastState(featureId(w, office, 'power')), 1);
  assert.equal(w.fake.lastState(featureId(w, office, 'fan_speed')), 91);
  assert.equal(w.fake.lastState(featureId(w, office, 'filter_life')), 50);
  assert.equal(w.fake.lastState(featureId(w, office, 'filter_replace')), 0);
  assert.equal(w.fake.lastState(featureId(w, office, 'voc')), 134);
  assert.equal(w.fake.lastState(featureId(w, office, 'temperature')), 23);
  assert.equal(w.fake.lastState(featureId(w, office, 'online')), 1);
  const mode = w.fake.states.find(
    (s) => s.device_feature_external_id === featureId(w, office, 'mode'),
  );
  assert.deepEqual(mode.text, 'manual');
  const bedroom = w.cloud.uuid('max211i');
  assert.equal(w.fake.lastState(featureId(w, bedroom, 'power')), undefined);
});

test('only what changed is published at the next cycles', async (t) => {
  const w = await world(t, { devices: ['protect7470i'] });
  await createAll(w);
  const before = w.fake.states.length;
  await w.hub.cycle();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');
  w.cloud.setState('protect7470i', 'fanspeed', 37);
  await w.hub.cycle();
  assert.equal(w.fake.states.length, before + 1);
  assert.equal(w.fake.lastState(featureId(w, w.cloud.uuid('protect7470i'), 'fan_speed')), 37);
});

test('classic purifier: power, speed, modes, brightness, child lock', async (t) => {
  const w = await world(t, { devices: ['protect7470i'] });
  await createAll(w);
  const uuid = w.cloud.uuid('protect7470i');

  assert.equal((await set(w, uuid, 'power', 0)).success, true);
  assert.equal((await set(w, uuid, 'mode', 'night')).success, true);
  // Leaving night mode: wait for the device before the speed (ha_blueair).
  assert.equal((await set(w, uuid, 'fan_speed', 37)).success, true);
  assert.deepEqual(w.sleeps, [2000]);
  assert.equal((await set(w, uuid, 'mode', 'auto')).success, true);
  assert.equal((await set(w, uuid, 'mode', 'manual')).success, true);
  assert.equal((await set(w, uuid, 'brightness', 140)).success, true);
  assert.equal((await set(w, uuid, 'child_lock', 0)).success, true);
  assert.deepEqual(
    w.cloud.commands.map(({ name, value }) => [name, value]),
    [
      ['standby', true],
      ['nightmode', true],
      ['nightmode', false],
      ['fanspeed', 37],
      ['automode', true],
      ['automode', false],
      ['brightness', 100],
      ['childlock', false],
    ],
  );
  const modes = w.fake.states.filter(
    (s) => s.device_feature_external_id === featureId(w, uuid, 'mode'),
  );
  assert.deepEqual(
    modes.map((s) => s.text),
    ['manual', 'night', 'manual', 'auto', 'manual'],
  );
  assert.equal(w.fake.lastState(featureId(w, uuid, 'power')), 0);
  assert.equal(w.fake.lastState(featureId(w, uuid, 'brightness')), 100);

  // The cloud confirms at the next cycle: nothing to correct.
  const before = w.fake.states.length;
  await w.hub.cycle();
  assert.equal(w.fake.states.length, before);
});

test('Signature: one apsubmode per mode, paired with the lowest speed; a speed leaves the mode', async (t) => {
  const w = await world(t, { devices: ['sp4i'] });
  await createAll(w);
  const uuid = w.cloud.uuid('sp4i');
  await set(w, uuid, 'mode', 'eco');
  await set(w, uuid, 'fan_speed', 60);
  assert.deepEqual(
    w.cloud.commands.map(({ name, value }) => [name, value]),
    [
      ['apsubmode', 4],
      ['fanspeed', 11],
      ['apsubmode', 0],
      ['fanspeed', 60],
    ],
  );
});

test('2-in-1: modes through `mode`; humidifier: speeds 1-3 written as 11/37/64', async (t) => {
  const w = await world(t, { devices: ['dh3i', 'h35i'] });
  await createAll(w);
  await set(w, w.cloud.uuid('dh3i'), 'mode', 'night');
  await set(w, w.cloud.uuid('dh3i'), 'fan_speed', 91);
  await set(w, w.cloud.uuid('h35i'), 'fan_speed', 3);
  assert.deepEqual(
    w.cloud.commands.map(({ name, value }) => [name, value]),
    [
      ['mode', 3],
      ['mode', 1],
      ['fanspeed', 91],
      ['fanspeed', 64],
    ],
  );
  assert.equal(w.fake.lastState(featureId(w, w.cloud.uuid('h35i'), 'fan_speed')), 3);
  await w.hub.cycle();
  assert.equal(w.fake.lastState(featureId(w, w.cloud.uuid('h35i'), 'fan_speed')), 3);
});

test('a heating device is read only: every command is refused, nothing is sent', async (t) => {
  const w = await world(t, { devices: ['t10i'] });
  await createAll(w);
  const uuid = w.cloud.uuid('t10i');
  for (const feature of discovered(w, uuid).features) {
    assert.equal(feature.read_only, true, feature.name);
  }
  const ack = await set(w, uuid, 'power', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /heats/);
  assert.deepEqual(w.cloud.commands, []);
  await assert.rejects(w.hub.applyMode(deviceId(w, uuid), 'auto'), /heats/);
});

test('a mode the device does not offer, a feature that cannot be set: refused', async (t) => {
  const w = await world(t, { devices: ['protect7470i'] });
  await createAll(w);
  const uuid = w.cloud.uuid('protect7470i');
  assert.equal((await set(w, uuid, 'mode', 'eco')).success, false);
  assert.equal((await set(w, uuid, 'pm25', 3)).success, false);
  assert.deepEqual(w.cloud.commands, []);
});

test('historical Classic: power through the fan speed, last speed restored, auto left for a speed', async (t) => {
  const device = legacyClassic480i();
  const w = await world(t, { devices: [], legacyDevices: [device] });
  await createAll(w);
  const uuid = device.listed.uuid;
  assert.equal(w.fake.lastState(featureId(w, uuid, 'pm25')), 7.5);
  assert.equal(w.fake.lastState(featureId(w, uuid, 'co2')), 612);
  assert.equal(w.fake.lastState(featureId(w, uuid, 'filter_replace')), 0);

  await set(w, uuid, 'power', 0);
  await set(w, uuid, 'power', 1);
  await set(w, uuid, 'mode', 'auto');
  await set(w, uuid, 'fan_speed', 3);
  await set(w, uuid, 'brightness', 9);
  await set(w, uuid, 'child_lock', 1);
  assert.deepEqual(
    w.cloud.commands.map(({ name, value }) => [name, value]),
    [
      ['fan_speed', '0'],
      ['fan_speed', '2'],
      ['mode', 'auto'],
      ['mode', 'manual'],
      ['fan_speed', '3'],
      ['brightness', 4],
      ['child_lock', '1'],
    ],
  );
  device.attributes.filter_status = 'Replace soon';
  await w.hub.cycle();
  assert.equal(w.fake.lastState(featureId(w, uuid, 'filter_replace')), 1);
});

test('a device listed by both clouds is kept once, on the current one', async (t) => {
  const cloud = new FakeBlueair({ devices: ['max211i'] });
  const twin = legacyClassic480i({ mac: '02:00:5E:00:53:01' });
  const other = legacyClassic480i({ uuid: 'B000000000000002', mac: 'A0A0A0A0A0A0' });
  cloud.legacy = true;
  cloud.legacyDevices.set(twin.listed.uuid, twin);
  cloud.legacyDevices.set(other.listed.uuid, other);
  const w = await world(t, { cloud });
  assert.deepEqual(w.fake.discoveredDevices.map((device) => device.params[1].value).sort(), [
    'aws',
    'legacy',
  ]);
});

test('filter to replace: one scene event per filter, kept across restarts, reset once replaced', async (t) => {
  const clock = createClock();
  const cloud = new FakeBlueair({ devices: ['protect7470i'], now: clock.now });
  const w = await world(t, { cloud, clock });
  cloud.setState('protect7470i', 'filterusage', 92);
  await w.hub.cycle();
  await w.hub.cycle();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: 'filter_to_replace',
      data: {
        device: deviceId(w, cloud.uuid('protect7470i')),
        device_name: 'Office',
        model: 'Blueair Protect 7470i',
        filter_life: 8,
      },
    },
  ]);
  await w.app.stop();

  // A restart: the alert is remembered under /data.
  const again = await world(t, { cloud, clock, dataDir: w.dataDir });
  await again.hub.cycle();
  assert.equal(again.fake.sceneEvents.length, 0);

  // A new filter, then worn out again: a new event.
  cloud.setState('protect7470i', 'filterusage', 0);
  await again.hub.cycle();
  cloud.setState('protect7470i', 'filterusage', 95);
  await again.hub.cycle();
  assert.equal(again.fake.sceneEvents.length, 1);
  assert.equal(again.fake.sceneEvents[0].data.filter_life, 5);
});

test('the filter threshold of the configuration drives the feature and the event', async (t) => {
  const w = await world(t, {
    devices: ['protect7470i'],
    config: { ...CONFIG, filter_threshold: '20' },
  });
  await createAll(w);
  const uuid = w.cloud.uuid('protect7470i');
  w.cloud.setState('protect7470i', 'filterusage', 85);
  await w.hub.cycle();
  assert.equal(w.fake.lastState(featureId(w, uuid, 'filter_replace')), 1);
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('a refused password stops every request until the configuration changes', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refused/);
  const requests = w.cloud.requests.length;
  for (let i = 0; i < 5; i += 1) {
    await w.hub.cycle();
  }
  assert.equal(w.cloud.requests.length, requests, 'no retry: Gigya would lock the account');

  await w.fake.configUpdated({ ...CONFIG });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 1);
});

test('a locked account and a pending registration explain themselves', async (t) => {
  const cloud = new FakeBlueair();
  cloud.pendingRegistration = {};
  const w = await world(t, { cloud });
  assert.match(w.fake.connectionStatus.message.fr, /appli Blueair/);
});

test('the cloud down: devices unreachable, status explained, back on its own', async (t) => {
  const w = await world(t, { devices: ['max211i'] });
  await createAll(w);
  const id = deviceId(w, w.cloud.uuid('max211i'));
  assert.deepEqual(w.fake.transports.at(-1), { device_external_id: id, transport: 'cloud' });
  w.cloud.online = false;
  await w.hub.cycle();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: id,
    transport: 'unreachable',
  });
  w.cloud.online = true;
  await w.hub.cycle();
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.deepEqual(w.fake.transports.at(-1), { device_external_id: id, transport: 'cloud' });
});

test('a 429 pauses every request for 10 minutes', async (t) => {
  const clock = createClock();
  const cloud = new FakeBlueair({ now: clock.now });
  const w = await world(t, { cloud, clock });
  cloud.rateLimited = true;
  cloud.expireAccess();
  await w.hub.cycle();
  const requests = cloud.requests.length;
  cloud.rateLimited = false;
  clock.advance(5 * 60_000);
  await w.hub.cycle();
  assert.equal(cloud.requests.length, requests);
  clock.advance(6 * 60_000);
  await w.hub.cycle();
  assert.ok(cloud.requests.length > requests);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('the tokens are kept under /data, readable by the container only; no login at restart', async (t) => {
  const clock = createClock();
  const cloud = new FakeBlueair({ now: clock.now });
  const w = await world(t, { cloud, clock });
  await w.app.stop();
  const file = join(w.dataDir, 'blueair-state.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(typeof saved.aws.accessToken, 'string');
  assert.ok(!JSON.stringify(saved).includes(CONFIG.password), 'never the password');
  assert.ok(!JSON.stringify(saved).includes(CONFIG.username), 'never the e-mail');

  const again = await world(t, { cloud, clock, dataDir: w.dataDir });
  assert.equal(cloud.logins, 1, 'the saved session is reused');
  assert.equal(again.fake.connectionStatus.connected, true);

  // Another account: the saved tokens are not its own.
  cloud.email = 'other@example.com';
  await again.fake.configUpdated({ ...CONFIG, username: 'other@example.com' });
  assert.equal(cloud.logins, 2);
});

test('scene action set_mode: one device, or every device that offers the mode', async (t) => {
  const w = await world(t, { devices: ['protect7470i', 'sp4i', 't10i'] });
  const all = await w.fake.sceneAction('set_mode', { mode: 'night' });
  assert.deepEqual(all, { success: true, data: { outputs: { count: 2 } } });
  const eco = await w.fake.sceneAction('set_mode', { mode: 'eco' });
  assert.deepEqual(eco.data.outputs, { count: 1 }, 'only the Signature has eco');
  const one = await w.fake.sceneAction('set_mode', {
    device: deviceId(w, w.cloud.uuid('protect7470i')),
    mode: 'auto',
  });
  assert.deepEqual(one.data.outputs, { count: 1 });
  const refused = await w.fake.sceneAction('set_mode', {
    device: deviceId(w, w.cloud.uuid('protect7470i')),
    mode: 'eco',
  });
  assert.equal(refused.success, false);
  const unknown = await w.fake.sceneAction('set_mode', { device: 'ext:test:blueair:gone' });
  assert.equal(unknown.success, false);
});

test('Test the connection: a report in four languages', async (t) => {
  const device = legacyClassic480i();
  const w = await world(t, { devices: ['max211i', 't10i'], legacyDevices: [device] });
  w.cloud.setState('max211i', 'standby', false);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  const { message } = ack.data;
  assert.deepEqual(Object.keys(message).sort(), ['de', 'en', 'es', 'fr']);
  assert.match(message.en, /^Blueair account: connected, 3 device\(s\)/);
  assert.match(message.en, /Study: Blueair ComfortPure 3-in-1 T10i, read only/);
  assert.match(message.fr, /Ancien cloud Blueair : 1 appareil/);

  const wrong = await world(t, { config: { ...CONFIG, password: 'nope' } });
  const refused = await wrong.fake.action('test_connection', {});
  assert.match(refused.data.message.de, /abgelehnt/);

  const empty = await world(t, { config: {} });
  const notConfigured = await empty.fake.action('test_connection', {});
  assert.match(notConfigured.data.message.es, /Introduzca/);
});

test('not configured: no request, the status says what to do', async (t) => {
  const w = await world(t, { config: {} });
  assert.equal(w.cloud.requests.length, 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Saisissez/);
  assert.deepEqual(w.fake.discoveredDevices, []);
});

test('an account without device says so; a search in the Discovery tab looks again', async (t) => {
  const w = await world(t, { devices: [] });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.match(w.fake.connectionStatus.message.en, /no device/);
  const max = new FakeBlueair({ devices: ['max211i'] });
  w.cloud.devices = max.devices;
  await w.fake.scanRequest();
  assert.equal(w.fake.discoveredDevices.length, 1);
});

test('Gladys restarts: every state is sent again', async (t) => {
  const w = await world(t, { devices: ['max211i'] });
  await createAll(w);
  const before = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.ok(w.fake.states.length >= before * 2);
});

test('one device answering oddly does not hide the others, nor fail the account', async (t) => {
  const cloud = new FakeBlueair({ devices: ['max211i', 'protect7470i'] });
  const original = cloud.blueCloud.bind(cloud);
  let broken = true;
  cloud.blueCloud = (method, target, headers, body) =>
    broken && body?.deviceconfigquery?.[0]?.id === cloud.uuid('max211i')
      ? { status: 404, headers: {}, body: '{"message":"Not found"}' }
      : original(method, target, headers, body);
  const w = await world(t, { cloud });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Office'],
  );
  assert.equal(w.fake.connectionStatus.connected, true);
  broken = false;
  await w.fake.scanRequest();
  assert.equal(w.fake.discoveredDevices.length, 2);
  // Known now: a later odd answer keeps it, marked unreachable.
  broken = true;
  await w.fake.scanRequest();
  assert.equal(w.fake.discoveredDevices.length, 2);
  const bedroom = w.hub.records.get(deviceId(w, cloud.uuid('max211i')));
  assert.equal(bedroom.reachable, false);
});

test('a new configuration during a reading waits for it, then looks for the devices', async (t) => {
  const w = await world(t, { devices: ['max211i'] });
  const reading = w.hub.cycle();
  const reconfigured = w.fake.configUpdated({ ...CONFIG, language: 'fr' });
  await Promise.all([reading, reconfigured]);
  const power = w.fake.discoveredDevices[0].features.find((f) => f.external_id.endsWith(':power'));
  assert.equal(power.name, 'Marche');
});

test('the historical cloud refusing an account the current cloud accepted: no old device, no error', async (t) => {
  const w = await world(t, { devices: ['max211i'] });
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true }, 'no failure message');
  const logins = () => w.cloud.requests.filter((r) => r.path.endsWith('/login/')).length;
  assert.equal(logins(), 1);
  // Not asked again: neither at the next discoveries, nor at a Scan.
  w.clock.advance(7 * 60 * 60_000);
  await w.hub.cycle();
  await w.fake.scanRequest();
  assert.equal(logins(), 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // New credentials: asked again, once (the saved Blueair session still works).
  await w.fake.configUpdated({ ...CONFIG, password: 'changed' });
  assert.equal(logins(), 2);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('both clouds refusing: the credentials are refused, said once, never retried', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong' }, legacyDevices: [] });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /refusé par Blueair/);
  const requests = w.cloud.requests.length;
  await w.hub.cycle();
  await w.fake.scanRequest();
  assert.equal(w.cloud.requests.length, requests);
  assert.ok(!w.cloud.requests.some((r) => r.host === 'api.blueair.io'));
});
