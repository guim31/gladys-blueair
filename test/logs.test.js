// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading cycle writes nothing, a failure that repeats is
// logged once, and its end once. Never the password, the e-mail, a token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EMAIL, PASSWORD } from './helpers/fakeBlueair.js';
import { CONFIG, FakeBlueair, createAll, createClock, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const clock = createClock();
  const cloud =
    options.cloud ?? new FakeBlueair({ devices: ['protect7470i', 'max211i'], now: clock.now });
  const w = await createWorld({ clock, cloud, ...options });
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  assert.ok(
    logs.texts().some((text) => text.includes('2 device(s) found')),
    'the start is logged',
  );
  logs.clear();

  for (let i = 0; i < 6; i += 1) {
    w.cloud.setState('protect7470i', 'fanspeed', 11 + i);
    w.clock.advance(2 * 60_000);
    await w.hub.cycle();
  }
  assert.deepEqual(logs.texts(), []);
});

test('the cloud down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.cloud.online = false;
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(2 * 60_000);
    await w.hub.cycle();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.cloud.online = true;
  await w.hub.cycle();
  await w.hub.cycle();
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['Blueair account: connection restored'],
  );
});

test('a refused password is logged once, never the password nor the e-mail', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { config: { ...CONFIG, password: 'wrong-password' } });
  for (let i = 0; i < 4; i += 1) {
    await w.hub.cycle();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 2, logs.texts().join('\n')); // the refusal, the stop
  const text = logs.texts().join('\n');
  assert.ok(!text.includes('wrong-password'), 'never the password');
  assert.ok(!text.includes(EMAIL), 'never the e-mail');
});

test('LOG_LEVEL=debug shows each problem again; never a secret of the config or a token', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  w.cloud.expireAccess();
  w.cloud.online = false;
  await w.hub.cycle();
  await w.hub.cycle();
  w.cloud.online = true;
  await w.hub.cycle();
  await w.fake.action('test_connection', {});
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assert.ok(!text.includes(PASSWORD), 'never the password');
  assert.ok(!text.includes(EMAIL), 'never the e-mail');
  await w.hub.store.flush();
  const saved = JSON.parse(await readFile(join(w.dataDir, 'blueair-state.json'), 'utf8'));
  for (const secret of [saved.aws.accessToken, saved.aws.sessionToken, saved.aws.sessionSecret]) {
    assert.ok(!text.includes(secret), 'never a token');
  }
});

test('a user command is one info line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  const device = w.fake.discoveredDevices[0];
  const feature = device.features.find((f) => f.external_id.endsWith(':mode'));
  await w.fake.setValue(device, feature, 'night');
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /\[INFO\].*: mode night$/);
});
