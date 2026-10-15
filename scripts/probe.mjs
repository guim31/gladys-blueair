#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Blueair clouds, through the clients of the integration.
//
//   node scripts/probe.mjs [region]
//     Runs the real login path with a made-up account, up to the refusal:
//     Gigya refuses the login (403042), BlueCloud refuses a made-up token,
//     the historical cloud does not know the e-mail. Proves the endpoints,
//     the public keys and the parsing of the answers, with no account.
//
//   BLUEAIR_USERNAME=... BLUEAIR_PASSWORD=... node scripts/probe.mjs [region]
//     Read-only run on a real account: logs in, lists the devices, reads each
//     one, and prints what the integration would publish. Never writes to a
//     device or to the account (a pending registration is reported, not
//     completed), never prints the e-mail, the password, a token, a device
//     id, a MAC address, a serial number or a device name.
//
// Exit code 0 when every step behaved as expected.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AwsClient } from '../src/blueair/aws.js';
import { ERROR_KINDS } from '../src/blueair/errors.js';
import { httpRequest } from '../src/blueair/http.js';
import { LegacyClient } from '../src/blueair/legacy.js';
import {
  awsSensorReadings,
  parseAwsDevice,
  parseLegacyDevice,
  parseTelemetry,
} from '../src/blueair/model.js';
import { REGIONS } from '../src/config.js';

/**
 * @param {object} options
 * @param {string} options.region
 * @param {string} [options.username] a real account (read-only run), else a made-up one
 * @param {string} [options.password]
 * @param {Function} [options.request] HTTP seam (tests)
 * @param {(line: string) => void} [options.print]
 * @param {() => number} [options.now]
 * @returns {Promise<boolean>} whether every step behaved as expected
 */
export async function probe({
  region,
  username,
  password,
  request = httpRequest,
  print = (line) => console.log(line),
  now = () => Date.now(),
}) {
  let ok = true;
  const step = (passed, text) => {
    ok &&= passed;
    print(`${passed ? 'OK  ' : 'FAIL'} ${text}`);
  };
  const real = Boolean(username && password);
  const account = real
    ? { username, password }
    : {
        username: `gladys-probe-${randomBytes(6).toString('hex')}@example.com`,
        password: randomBytes(12).toString('hex'),
      };
  print(
    `Blueair probe, region ${region}, ${real ? 'real account (read only)' : 'made-up account'}`,
  );

  // --- Current cloud ----------------------------------------------------------
  const aws = new AwsClient({ ...account, region, request, now, completeRegistration: false });
  if (!real) {
    try {
      await aws.loginSession();
      step(false, 'Gigya accounts.login accepted a made-up account');
    } catch (err) {
      step(err.kind === ERROR_KINDS.AUTH, `Gigya accounts.login refused it: ${err.kind}`);
    }
    try {
      await aws.exchange('not-a-real-id-token');
      step(false, 'BlueCloud /c/login accepted a made-up id token');
    } catch (err) {
      step(
        err.kind === ERROR_KINDS.SESSION,
        `BlueCloud /c/login refused a made-up id token: ${err.kind}`,
      );
    }
  } else {
    try {
      const devices = await aws.devices();
      step(true, `current cloud: logged in, ${devices.length} device(s)`);
      for (const [index, entry] of devices.entries()) {
        const info = await aws.deviceInfo(entry.uuid);
        const { profile, readings, sensors } = parseAwsDevice(info, entry);
        let sensorValues = sensors.values;
        const wanted = Object.values(profile.sensorKeys).filter(Boolean);
        if (wanted.some((key) => sensorValues[key] === undefined)) {
          const to = Math.floor(now() / 1000);
          sensorValues = {
            ...parseTelemetry(await aws.telemetry(entry.uuid, to - 3600, to)).values,
            ...sensorValues,
          };
        }
        const features = Object.entries(profile.features)
          .filter(([, value]) => value !== false && value !== null)
          .map(([key]) => key);
        print(
          `     #${index + 1} ${profile.model} (hw ${profile.hardware || '?'}, ` +
            `modes ${profile.modeFamily ?? 'none'}${profile.controllable ? '' : ', read only'})`,
        );
        print(`        features: ${features.join(', ')}`);
        print(
          `        readings: ${JSON.stringify({ ...readings, ...awsSensorReadings(profile, sensorValues) })}`,
        );
      }
    } catch (err) {
      step(false, `current cloud: ${err.kind ?? 'error'}: ${err.message}`);
    }
  }

  // --- Historical cloud ----------------------------------------------------------
  const legacy = new LegacyClient({ ...account, request });
  try {
    const known = await legacy.connect();
    if (!real) {
      step(!known, `historical cloud: ${known ? 'knows' : 'does not know'} the made-up e-mail`);
    } else if (!known) {
      step(true, 'historical cloud: no device of that generation on the account');
    } else {
      const devices = await legacy.devices();
      step(true, `historical cloud: ${devices.length} device(s)`);
      for (const [index, entry] of devices.entries()) {
        const [info, attributes] = await Promise.all([
          legacy.info(entry.uuid),
          legacy.attributes(entry.uuid),
        ]);
        const { profile, readings } = parseLegacyDevice(info ?? {}, attributes, entry);
        print(`     #${index + 1} ${profile.model} (${profile.hardware || '?'})`);
        print(`        attributes: ${Object.keys(attributes).sort().join(', ')}`);
        print(`        readings: ${JSON.stringify(readings)}`);
      }
    }
  } catch (err) {
    // A real account the historical cloud refuses is an account without such device.
    const expected = real && err.kind === ERROR_KINDS.AUTH;
    step(expected, `historical cloud: ${err.kind ?? 'error'}: ${err.message}`);
  }
  return ok;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const region = process.argv[2] ?? 'eu';
  if (!REGIONS.includes(region)) {
    console.error(`Region must be one of ${REGIONS.join(', ')}`);
    process.exit(2);
  }
  const ok = await probe({
    region,
    username: process.env.BLUEAIR_USERNAME,
    password: process.env.BLUEAIR_PASSWORD,
  });
  process.exit(ok ? 0 : 1);
}
