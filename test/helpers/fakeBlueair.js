// -----------------------------------------------------------------------------
// An in-memory Blueair cloud, behind the `request` seam of the clients: Gigya
// (login, session, registration), BlueCloud (access token, device list,
// device state, telemetry, commands) and the historical cloud. The devices of
// the current cloud are the real captures of test/fixtures/blueair/aws.
//
// Knobs for the tests: `online` (false: every request fails like fetch does),
// `rateLimited`, `password`, `pendingRegistration`, `expireAccess()`,
// `legacy` (the account on the historical cloud), and `requests` (what was
// asked, method + path, never the credentials).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { AWS_REGIONS } from '../../src/blueair/aws.js';
import { LEGACY_API_KEY } from '../../src/blueair/legacy.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/blueair/${name}`, import.meta.url), 'utf8'));

export const EMAIL = 'someone@example.com';
export const PASSWORD = 'correct-horse-battery';

// The current-cloud devices of the fixtures: file, device list entry.
export const AWS_DEVICES = {
  max211i: { file: 'aws/blue-pure-211i-max.json', type: 'nb_h' },
  max311i: { file: 'aws/blue-pure-311i-max.json', type: 'nb_m' },
  protect7470i: {
    file: 'aws/protect-7470i.json',
    type: 'high',
    telemetry: 'aws/protect-7470i-telemetry.json',
  },
  sp4i: { file: 'aws/signature-sp4i.json', type: 'blue40' },
  dh3i: { file: 'aws/dh3i-2-in-1.json', type: 's_cmb2in1' },
  t10i: { file: 'aws/comfortpure-t10i.json', type: 'cmb3in1' },
  h35i: { file: 'aws/humidifier-h35i.json', type: 'hum' },
};

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeJwt = (claims) => `${base64url({ alg: 'none' })}.${base64url(claims)}.signature`;

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** A device of the historical cloud (synthetic, from the shapes of blueair_api). */
export function legacyClassic480i({ uuid = 'A1B2C3D4E5F60001', mac = 'A0B1C2D3E4F5' } = {}) {
  return {
    listed: { uuid, userId: 12345, mac, name: 'Classic in the hall' },
    info: {
      compatibility: 'classic_480i',
      model: '480i',
      firmware: '1.0.9',
      mcuFirmware: '1.0.9',
      wlanDriver: '1.0.0',
      roomLocation: 'hall',
      timezone: 'Europe/Paris',
    },
    attributes: {
      brightness: '3',
      child_lock: '0',
      fan_speed: '2',
      filter_status: 'OK',
      mode: 'manual',
      wifi_status: '1',
    },
    dataPoint: {
      uuid,
      sensors: ['time', 'pm', 'pm1', 'pm10', 'tmp', 'hum', 'co2', 'voc', 'allpollu'],
      datapoints: [[1760000000, 7.5, 4, 9, 21.4, 44, 612, 180, 12]],
    },
  };
}

export class FakeBlueair {
  /**
   * @param {object} [options]
   * @param {string} [options.region]
   * @param {string[]} [options.devices] keys of AWS_DEVICES on the account
   * @param {Array} [options.legacyDevices] devices of the historical cloud (legacyClassic480i)
   * @param {() => number} [options.now]
   */
  constructor({
    region = 'eu',
    devices = ['max211i'],
    legacyDevices = [],
    now = () => Date.now(),
  } = {}) {
    this.region = region;
    this.endpoints = AWS_REGIONS[region];
    this.now = now;
    this.email = EMAIL;
    this.password = PASSWORD;
    this.online = true;
    this.rateLimited = false;
    this.pendingRegistration = null;
    this.registrationCompleted = false;
    this.legacy = legacyDevices.length > 0;
    // What the historical cloud answers for an unknown e-mail: 'host' (seen) or '404'.
    this.unknownHomeHost = 'host';
    this.requests = [];
    this.logins = 0;
    this.sessions = new Set();
    this.accessTokens = new Set();
    this.idTokens = new Set();
    this.userId = 'us-east-2:00000000-0000-4000-8000-0000000000aa';
    /** @type {Map<string, object>} current-cloud devices by uuid */
    this.devices = new Map();
    for (const key of devices) {
      const spec = AWS_DEVICES[key];
      const info = fixture(spec.file);
      this.devices.set(info.id, {
        key,
        listed: {
          uuid: info.id,
          name: info.configuration?.di?.name ?? key,
          mac: info.configuration?.di?.cma ?? '',
          type: spec.type,
        },
        info,
        telemetry: spec.telemetry ? fixture(spec.telemetry) : [],
      });
    }
    /** @type {Map<string, object>} historical-cloud devices by uuid */
    this.legacyDevices = new Map(legacyDevices.map((device) => [device.listed.uuid, device]));
    this.legacyTokens = new Set();
    this.legacyLogins = 0;
    this.commands = [];
    this.request = this.request.bind(this);
  }

  /** The uuid of a device of the fixtures. */
  uuid(key) {
    return [...this.devices.values()].find((device) => device.key === key).listed.uuid;
  }

  device(key) {
    return this.devices.get(this.uuid(key));
  }

  /** Set a state of a current-cloud device, as the app or the device would. */
  setState(key, name, value) {
    const { info } = this.device(key);
    const field = typeof value === 'boolean' ? 'vb' : 'v';
    const record = info.states.find((state) => state.n === name);
    const t = Math.floor(this.now() / 1000);
    if (record) {
      delete record.v;
      delete record.vb;
      record[field] = value;
      record.t = t;
    } else {
      info.states.push({ n: name, [field]: value, t });
    }
  }

  /** Make the access tokens expire early (refused with 403). */
  expireAccess() {
    this.accessTokens.clear();
  }

  // --- The request seam --------------------------------------------------------

  async request(url, { method = 'GET', headers = {}, form, json: body } = {}) {
    const target = new URL(url);
    this.requests.push({ method, host: target.host, path: target.pathname });
    if (!this.online) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    if (this.rateLimited) {
      return json(429, { message: 'Too Many Requests' });
    }
    if (target.host === this.endpoints.gigya) {
      return this.gigya(target.pathname.slice(1), form ?? {});
    }
    if (target.host === `${this.endpoints.restApiId}.execute-api.${this.endpoints.awsRegion}`) {
      return this.blueCloud(method, target, headers, body);
    }
    if (target.host === 'api.blueair.io' || target.host === 'eu.home.blueair.io') {
      return this.historical(method, target, headers, body);
    }
    const error = new TypeError('fetch failed');
    error.cause = { code: 'ENOTFOUND' };
    throw error;
  }

  // --- Gigya -------------------------------------------------------------------------

  gigya(path, form) {
    if (form.apikey !== this.endpoints.apiKey) {
      return json(200, { statusCode: 400, errorCode: 400093, errorMessage: 'Invalid ApiKey' });
    }
    if (path === 'accounts.login') {
      if (form.loginID !== this.email || form.password !== this.password) {
        return json(200, {
          statusCode: 403,
          errorCode: 403042,
          errorMessage: 'Invalid LoginID',
        });
      }
      if (this.pendingRegistration && !this.registrationCompleted) {
        return json(200, {
          statusCode: 206,
          errorCode: 206001,
          errorMessage: 'Account Pending Registration',
          regToken: 'reg-token',
          profile: this.pendingRegistration,
        });
      }
      this.logins += 1;
      const session = `session-${this.logins}`;
      this.sessions.add(session);
      return json(200, {
        statusCode: 200,
        errorCode: 0,
        sessionInfo: { sessionToken: session, sessionSecret: `secret-${this.logins}` },
      });
    }
    if (path === 'accounts.getJWT') {
      if (!this.sessions.has(form.oauth_token)) {
        return json(200, { statusCode: 403, errorCode: 403005, errorMessage: 'Unauthorized user' });
      }
      const idToken = fakeJwt({ sub: 'gigya', n: this.idTokens.size });
      this.idTokens.add(idToken);
      return json(200, { statusCode: 200, errorCode: 0, id_token: idToken });
    }
    if (path === 'accounts.setAccountInfo' || path === 'accounts.finalizeRegistration') {
      if (form.regToken !== 'reg-token') {
        return json(200, { statusCode: 400, errorCode: 400006, errorMessage: 'Invalid regToken' });
      }
      if (path === 'accounts.finalizeRegistration') {
        this.registrationCompleted = true;
      }
      return json(200, { statusCode: 200, errorCode: 0 });
    }
    return json(200, { statusCode: 404, errorCode: 404000 });
  }

  // --- BlueCloud ---------------------------------------------------------------------

  blueCloud(method, target, headers, body) {
    const path = target.pathname.replace(/^\/prod\/c/, '');
    if (method === 'POST' && path === '/login') {
      // The answers of the real BlueCloud to a made-up token (probed 2026-10-15).
      if (!this.idTokens.has(headers.idtoken)) {
        return json(400, { message: 'Token invalid or Request Timeout' });
      }
      const accessToken = fakeJwt({
        username: this.userId,
        exp: Math.floor(this.now() / 1000) + 24 * 3600,
        n: this.accessTokens.size,
      });
      this.accessTokens.add(accessToken);
      return json(200, {
        access_token: accessToken,
        'ba_X-Amz-CustomAuthorizer-Name': 'mqtt-authorizer',
      });
    }
    const token = (headers.authorization ?? '').replace(/^Bearer /, '');
    if (!this.accessTokens.has(token)) {
      return json(403, {
        Message:
          'User is not authorized to access this resource because no identity-based policy allows the execute-api:Invoke action',
      });
    }
    if (method === 'GET' && path === '/registered-devices') {
      return json(200, { devices: [...this.devices.values()].map((device) => device.listed) });
    }
    if (method === 'POST' && path === `/${this.userId}/r/initial`) {
      const id = body?.deviceconfigquery?.[0]?.id;
      const device = this.devices.get(id);
      if (!device) {
        return json(404, { message: 'Not found' });
      }
      return json(200, { deviceInfo: [structuredClone(device.info)] });
    }
    if (method === 'GET' && path === `/${this.userId}/r/telemetry/5m/historical`) {
      const device = this.devices.get(target.searchParams.get('did'));
      if (!device) {
        return json(404, { message: 'Not found' });
      }
      return json(200, structuredClone(device.telemetry));
    }
    const command = path.match(/^\/([^/]+)\/a\/([a-z0-9_]+)$/i);
    if (method === 'POST' && command) {
      const device = this.devices.get(decodeURIComponent(command[1]));
      if (!device || body?.n !== command[2]) {
        return json(404, { message: 'Not found' });
      }
      const value = body.vb !== undefined ? body.vb : body.v;
      this.commands.push({ device: device.key, name: body.n, value });
      this.setState(device.key, body.n, value);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '"Success"' };
    }
    return json(404, { message: 'Not found' });
  }

  // --- Historical cloud --------------------------------------------------------------

  historical(method, target, headers, body) {
    if (headers['x-api-key-token'] !== LEGACY_API_KEY) {
      return json(401, { message: 'bad key' });
    }
    const path = decodeURIComponent(target.pathname);
    if (target.host === 'api.blueair.io') {
      // The real cloud gives a home host even for an unknown e-mail (the probe
      // of 2026-10-15), then refuses its login; blueair_api also handles a 404.
      if (/^\/v2\/user\/[^/]+\/homehost\/$/.test(path)) {
        return this.legacy || this.unknownHomeHost === 'host'
          ? { status: 200, headers: {}, body: '"eu.home.blueair.io"' }
          : { status: 404, headers: {}, body: '' };
      }
      return { status: 404, headers: {}, body: '' };
    }
    if (/^\/v2\/user\/[^/]+\/login\/$/.test(path)) {
      if (!this.legacy || path !== `/v2/user/${this.email}/login/`) {
        return { status: 404, headers: {}, body: '' };
      }
      const expected = `Basic ${Buffer.from(`${this.email}:${this.password}`).toString('base64')}`;
      if (headers.authorization !== expected) {
        return { status: 200, headers: {}, body: 'false' };
      }
      this.legacyLogins += 1;
      const token = `legacy-token-${this.legacyLogins}`;
      this.legacyTokens.add(token);
      return { status: 200, headers: { 'x-auth-token': token }, body: 'true' };
    }
    if (!this.legacyTokens.has(headers['x-auth-token'])) {
      return json(401, { message: 'token' });
    }
    if (path === `/v2/owner/${this.email}/device/`) {
      return json(
        200,
        [...this.legacyDevices.values()].map((device) => device.listed),
      );
    }
    const match = path.match(
      /^\/v2\/device\/([^/]+)\/(info|attributes|datapoint\/0\/last\/0|attribute\/[a-z_]+)\/$/,
    );
    const device = match ? this.legacyDevices.get(match[1]) : null;
    if (!device) {
      return json(404, { message: 'Not found' });
    }
    if (match[2] === 'info') {
      return json(200, device.info);
    }
    if (match[2] === 'attributes') {
      return json(
        200,
        Object.entries(device.attributes).map(([name, currentValue]) => ({
          name,
          currentValue,
          scope: 'device',
          uuid: device.listed.uuid,
        })),
      );
    }
    if (match[2].startsWith('datapoint')) {
      return json(200, device.dataPoint);
    }
    if (method === 'POST') {
      this.commands.push({ device: device.listed.uuid, name: body.name, value: body.currentValue });
      device.attributes[body.name] = String(body.currentValue);
      return json(200, { ...body });
    }
    return json(404, { message: 'Not found' });
  }
}
