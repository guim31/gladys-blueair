// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the fake Blueair cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the cloud with `world.hub.cycle()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { EMAIL, FakeBlueair, PASSWORD } from './fakeBlueair.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the fake cloud (the fixtures date from 2025). */
export function createClock(start = Date.UTC(2025, 4, 17, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = {
  username: EMAIL,
  password: PASSWORD,
  region: 'eu',
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {FakeBlueair} [options.cloud]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  cloud,
  devices: cloudDevices,
  legacyDevices,
  config = CONFIG,
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-blueair-')),
  timings = {},
  timers = false,
} = {}) {
  const blueair =
    cloud ?? new FakeBlueair({ devices: cloudDevices, legacyDevices, now: clock.now });
  const gladys = createFakeGladys({ config, devices: created });
  const sleeps = [];
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: blueair.request,
    timers,
    timings,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    cloud: blueair,
    app,
    hub: app.hub,
    clock,
    dataDir,
    sleeps,
  };
}

/** External ids of the Gladys device of a cloud device. */
export const deviceId = (world, uuid) => world.gladys.externalIds('blueair', uuid).device;
export const featureId = (world, uuid, key) =>
  world.gladys.externalIds('blueair', uuid).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** The discovered device of a cloud device. */
export const discovered = (world, uuid) =>
  world.fake.discoveredDevices.find((device) => device.external_id === deviceId(world, uuid));

export { FakeBlueair };
