// -----------------------------------------------------------------------------
// The two Blueair clients against the fake cloud: login, session reuse,
// renewal of a refused token, the refusals that must stop the retries, and
// the exact commands sent.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AwsClient, AWS_REGIONS, jwtClaims } from '../src/blueair/aws.js';
import { ERROR_KINDS } from '../src/blueair/errors.js';
import { LegacyClient } from '../src/blueair/legacy.js';
import { EMAIL, FakeBlueair, PASSWORD, legacyClassic480i } from './helpers/fakeBlueair.js';

const NOW = Date.UTC(2025, 4, 17, 10, 0, 0);

function aws(cloud, options = {}) {
  return new AwsClient({
    username: EMAIL,
    password: PASSWORD,
    region: 'eu',
    request: cloud.request,
    now: () => NOW,
    ...options,
  });
}

const paths = (cloud) => cloud.requests.map((request) => request.path.replace(/^\/prod\/c/, ''));

test('current cloud: login, device list, device state, telemetry', async () => {
  const cloud = new FakeBlueair({ devices: ['max211i', 'protect7470i'], now: () => NOW });
  const saved = [];
  const client = aws(cloud, { onTokens: (tokens) => saved.push(tokens) });
  const devices = await client.devices();
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Bedroom', 'Office'],
  );
  assert.deepEqual(paths(cloud), [
    '/accounts.login',
    '/accounts.getJWT',
    '/login',
    '/registered-devices',
  ]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].userId, cloud.userId);
  assert.equal(saved[0].accessExpiresAt, NOW + 24 * 3600 * 1000);

  const info = await client.deviceInfo(cloud.uuid('protect7470i'));
  assert.equal(info.configuration.di.name, 'Office');
  const telemetry = await client.telemetry(cloud.uuid('protect7470i'), 1, 2);
  assert.equal(telemetry[0].sensors.length, 8);
  assert.equal(cloud.logins, 1, 'one login for every request');
});

test('saved tokens: no login after a restart; a refused token is renewed from the session', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  let saved = null;
  const first = aws(cloud, { onTokens: (tokens) => (saved = tokens) });
  await first.devices();
  assert.equal(cloud.logins, 1);

  cloud.requests = [];
  const second = aws(cloud, { tokens: saved, onTokens: (tokens) => (saved = tokens) });
  await second.devices();
  assert.deepEqual(paths(cloud), ['/registered-devices'], 'the saved access token is reused');

  cloud.requests = [];
  cloud.expireAccess();
  await second.devices();
  assert.deepEqual(paths(cloud), [
    '/registered-devices',
    '/accounts.getJWT',
    '/login',
    '/registered-devices',
  ]);
  assert.equal(cloud.logins, 1, 'the password is not sent again');

  cloud.requests = [];
  cloud.expireAccess();
  cloud.sessions.clear();
  await second.devices();
  assert.deepEqual(paths(cloud), [
    '/registered-devices',
    '/accounts.getJWT',
    '/accounts.login',
    '/accounts.getJWT',
    '/login',
    '/registered-devices',
  ]);
  assert.equal(cloud.logins, 2);
});

test('an expired access token is renewed before the request', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  let now = NOW;
  const client = aws(cloud, { now: () => now });
  await client.devices();
  cloud.requests = [];
  now += 24 * 3600 * 1000;
  await client.devices();
  assert.deepEqual(paths(cloud), ['/accounts.getJWT', '/login', '/registered-devices']);
});

test('refused password, locked account, pending registration without a name', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  await assert.rejects(aws(cloud, { password: 'wrong' }).devices(), { kind: ERROR_KINDS.AUTH });

  const locked = new FakeBlueair({ now: () => NOW });
  locked.gigya = () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ statusCode: 403, errorCode: 403120, errorMessage: 'Account locked' }),
  });
  await assert.rejects(aws(locked).devices(), { kind: ERROR_KINDS.LOCKED });

  const pending = new FakeBlueair({ now: () => NOW });
  pending.pendingRegistration = {};
  await assert.rejects(aws(pending).devices(), { kind: ERROR_KINDS.REGISTRATION });
  assert.equal(pending.registrationCompleted, false);
});

test('a pending registration is completed with the profile name, like the app does', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  cloud.pendingRegistration = { firstName: 'Ada', lastName: 'Lovelace' };
  const notices = [];
  const devices = await aws(cloud, { onNotice: (text) => notices.push(text) }).devices();
  assert.equal(devices.length, 1);
  assert.equal(cloud.registrationCompleted, true);
  assert.equal(notices.length, 1);
  assert.deepEqual(paths(cloud).slice(0, 4), [
    '/accounts.login',
    '/accounts.setAccountInfo',
    '/accounts.finalizeRegistration',
    '/accounts.login',
  ]);

  // The probe never writes to the account.
  const probe = new FakeBlueair({ now: () => NOW });
  probe.pendingRegistration = { firstName: 'Ada' };
  await assert.rejects(aws(probe, { completeRegistration: false }).devices(), {
    kind: ERROR_KINDS.REGISTRATION,
  });
  assert.equal(probe.registrationCompleted, false);
});

test('network failure, rate limit, server error: the right kinds', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  cloud.online = false;
  await assert.rejects(aws(cloud).devices(), { kind: ERROR_KINDS.UNREACHABLE });
  cloud.online = true;
  cloud.rateLimited = true;
  await assert.rejects(aws(cloud).devices(), { kind: ERROR_KINDS.RATE_LIMIT });
  cloud.rateLimited = false;
  const client = aws(cloud);
  await client.devices();
  cloud.blueCloud = () => ({ status: 503, headers: {}, body: 'Service Unavailable' });
  await assert.rejects(client.devices(), { kind: ERROR_KINDS.UNREACHABLE });
  cloud.blueCloud = () => ({ status: 200, headers: {}, body: '{"statusCode": 502}' });
  await assert.rejects(client.devices(), { kind: ERROR_KINDS.UNREACHABLE });
  cloud.blueCloud = () => ({ status: 200, headers: {}, body: '{"nothing": true}' });
  await assert.rejects(client.devices(), { kind: ERROR_KINDS.HTTP });
});

test('commands: one attribute, `v` for numbers and `vb` for booleans', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  const client = aws(cloud);
  const uuid = cloud.uuid('max211i');
  await client.setAttribute(uuid, 'standby', 'vb', true);
  await client.setAttribute(uuid, 'fanspeed', 'v', 37);
  assert.deepEqual(cloud.commands, [
    { device: 'max211i', name: 'standby', value: true },
    { device: 'max211i', name: 'fanspeed', value: 37 },
  ]);
});

test('every region has its endpoints; an unknown one is refused', () => {
  assert.deepEqual(Object.keys(AWS_REGIONS), ['us', 'eu', 'au', 'cn']);
  assert.throws(() => aws(new FakeBlueair(), { region: 'mars' }));
  assert.deepEqual(jwtClaims('not-a-jwt'), {});
});

test('historical cloud: no account, then login, list, read, write', async () => {
  // An unknown e-mail: a home host, then a refused login (the real answer, 2026-10-15)…
  const none = new FakeBlueair();
  const client = new LegacyClient({ username: EMAIL, password: PASSWORD, request: none.request });
  await assert.rejects(client.connect(), { kind: ERROR_KINDS.AUTH });
  // … or a 404 on the home host (handled by blueair_api too).
  const unknown = new FakeBlueair();
  unknown.unknownHomeHost = '404';
  const other = new LegacyClient({ username: EMAIL, password: PASSWORD, request: unknown.request });
  assert.equal(await other.connect(), false);

  const device = legacyClassic480i();
  const cloud = new FakeBlueair({ legacyDevices: [device] });
  let saved = null;
  const legacy = new LegacyClient({
    username: EMAIL,
    password: PASSWORD,
    request: cloud.request,
    onTokens: (tokens) => (saved = tokens),
  });
  const devices = await legacy.devices();
  assert.deepEqual(
    devices.map((entry) => entry.uuid),
    [device.listed.uuid],
  );
  assert.deepEqual(saved, { homeHost: 'eu.home.blueair.io', authToken: 'legacy-token-1' });
  assert.equal((await legacy.attributes(device.listed.uuid)).fan_speed, '2');
  assert.equal((await legacy.info(device.listed.uuid)).compatibility, 'classic_480i');
  assert.equal((await legacy.latestDataPoint(device.listed.uuid)).sensors[1], 'pm');

  await legacy.setAttribute(device.listed.uuid, 'fan_speed', 3);
  await legacy.setAttribute(device.listed.uuid, 'mode', 'auto');
  await legacy.setAttribute(device.listed.uuid, 'brightness', 4);
  await legacy.setAttribute(device.listed.uuid, 'child_lock', '1');
  assert.deepEqual(
    cloud.commands.map(({ name, value }) => [name, value]),
    [
      ['fan_speed', '3'],
      ['mode', 'auto'],
      ['brightness', 4],
      ['child_lock', '1'],
    ],
  );

  // A token refused later is renewed once.
  cloud.legacyTokens.clear();
  assert.equal((await legacy.attributes(device.listed.uuid)).fan_speed, '3');
  assert.equal(saved.authToken, 'legacy-token-2');
});

test('historical cloud: a refused password, an odd home host', async () => {
  const cloud = new FakeBlueair({ legacyDevices: [legacyClassic480i()] });
  const wrong = new LegacyClient({ username: EMAIL, password: 'nope', request: cloud.request });
  await assert.rejects(wrong.devices(), { kind: ERROR_KINDS.AUTH });

  const odd = new FakeBlueair({ legacyDevices: [legacyClassic480i()] });
  const original = odd.historical.bind(odd);
  odd.historical = (method, target, headers, body) =>
    target.pathname.endsWith('/homehost/')
      ? { status: 200, headers: {}, body: '"evil.example/path?x=1"' }
      : original(method, target, headers, body);
  const client = new LegacyClient({ username: EMAIL, password: PASSWORD, request: odd.request });
  await assert.rejects(client.connect(), { kind: ERROR_KINDS.HTTP });
});

test('an id token refused by BlueCloud (HTTP 400) leads to a new login, once', async () => {
  const cloud = new FakeBlueair({ now: () => NOW });
  const client = aws(cloud);
  await client.devices();
  cloud.requests = [];
  cloud.expireAccess();
  // The next id token from the saved session is refused (the real answer: 400).
  const has = cloud.idTokens.has.bind(cloud.idTokens);
  let refuse = true;
  cloud.idTokens.has = (token) => (refuse ? ((refuse = false), false) : has(token));
  await client.devices();
  assert.deepEqual(paths(cloud), [
    '/registered-devices',
    '/accounts.getJWT',
    '/login',
    '/accounts.login',
    '/accounts.getJWT',
    '/login',
    '/registered-devices',
  ]);
});
