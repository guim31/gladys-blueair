// -----------------------------------------------------------------------------
// Client of the historical Blueair cloud (api.blueair.io), still serving the
// purifiers of the first Wi-Fi generation (Classic 205/280i/290i/480i/680i,
// Sense+, Pro...). Same account as the current cloud, other servers.
//
// Protocol, as implemented by dahlb/blueair_api (MIT, see the README credits):
// a fixed public API key, a "home host" per account, a login that returns an
// X-AUTH-TOKEN header, then REST reads and writes per device. The data points
// only change every 5 minutes on the server side.
// -----------------------------------------------------------------------------

import { BlueairError, ERROR_KINDS, networkError, parseJson, statusError } from './errors.js';

// The public API key of the historical Blueair app (in the MIT library): nothing secret.
export const LEGACY_API_KEY =
  'eyJhbGciOiJIUzI1NiJ9.eyJncmFudGVlIjoiYmx1ZWFpciIsImlhdCI6MTQ1MzEyNTYzMiwidmFsaWRpdHkiOi0xLCJqdGkiOiJkNmY3OGE0Yi1iMWNkLTRkZDgtOTA2Yi1kN2JkNzM0MTQ2NzQiLCJwZXJtaXNzaW9ucyI6WyJhbGwiXSwicXVvdGEiOi0xLCJyYXRlTGltaXQiOi0xfQ.CJsfWVzFKKDDA6rWdh-hjVVVE9S3d6Hu9BzXG9htWFw';

export const LEGACY_ROOT = 'https://api.blueair.io';

// The e-mail goes in the URL path: encoded, the @ kept readable.
const pathUser = (username) => encodeURIComponent(username).replace(/%40/g, '@');

export class LegacyClient {
  /**
   * @param {object} options
   * @param {string} options.username
   * @param {string} options.password
   * @param {Function} options.request HTTP seam
   * @param {object|null} [options.tokens] `{ homeHost, authToken }` saved by a previous run
   * @param {(tokens: object) => void} [options.onTokens]
   */
  constructor({ username, password, request, tokens = null, onTokens = () => {} }) {
    this.username = username;
    this.password = password;
    this.request = request;
    this.onTokens = onTokens;
    this.homeHost = tokens?.homeHost ?? null;
    this.authToken = tokens?.authToken ?? null;
  }

  async call(url, { method = 'GET', headers = {}, json, what }) {
    try {
      return await this.request(url, {
        method,
        headers: { 'x-api-key-token': LEGACY_API_KEY, ...headers },
        json,
      });
    } catch (err) {
      throw networkError(err, what);
    }
  }

  /**
   * The server of the account. Resolves null when the historical cloud does
   * not know the e-mail: the account has no device of that generation.
   */
  async findHomeHost() {
    const response = await this.call(
      `${LEGACY_ROOT}/v2/user/${pathUser(this.username)}/homehost/`,
      { what: 'Blueair (historical) account' },
    );
    if (response.status === 404) {
      return null;
    }
    if (response.status !== 200) {
      throw statusError(response.status, 'Blueair (historical) account');
    }
    const host = response.body.replace(/"/g, '').trim();
    // Only a host name is accepted: never a path, a port or credentials.
    if (!/^[a-z0-9.-]+$/i.test(host)) {
      throw new BlueairError(ERROR_KINDS.HTTP, 'Blueair (historical) account: unexpected host');
    }
    return host;
  }

  async login() {
    const response = await this.call(
      `https://${this.homeHost}/v2/user/${pathUser(this.username)}/login/`,
      {
        headers: {
          authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
        },
        what: 'Blueair (historical) login',
      },
    );
    if (response.status === 404 || (response.status === 200 && response.body.trim() !== 'true')) {
      throw new BlueairError(ERROR_KINDS.AUTH, 'Blueair (historical) login: refused');
    }
    if (response.status !== 200) {
      throw statusError(response.status, 'Blueair (historical) login');
    }
    const token = response.headers['x-auth-token'];
    if (!token) {
      throw new BlueairError(ERROR_KINDS.HTTP, 'Blueair (historical) login: no token');
    }
    this.authToken = token;
    this.onTokens({ homeHost: this.homeHost, authToken: this.authToken });
  }

  /**
   * Log in when needed. Resolves false when the historical cloud does not
   * know the account (most accounts today).
   */
  async connect() {
    if (this.homeHost === null) {
      this.homeHost = await this.findHomeHost();
      if (this.homeHost === null) {
        return false;
      }
    }
    if (this.authToken === null) {
      await this.login();
    }
    return true;
  }

  /** An authenticated request; a refused token is renewed once. */
  async authed(path, { method = 'GET', json, what }) {
    for (let attempt = 0; ; attempt += 1) {
      if (!(await this.connect())) {
        throw new BlueairError(ERROR_KINDS.AUTH, `${what}: unknown account`);
      }
      const response = await this.call(`https://${this.homeHost}/v2${path}`, {
        method,
        headers: { 'x-auth-token': this.authToken },
        json,
        what,
      });
      if (response.status === 200) {
        return response.body === '' ? null : parseJson(response.body, what);
      }
      const error = statusError(response.status, what);
      if (error.kind === ERROR_KINDS.SESSION && attempt === 0) {
        this.authToken = null;
        continue;
      }
      throw error;
    }
  }

  /** @returns {Promise<Array<{ uuid: string, name: string, mac: string }>>} */
  async devices() {
    const list = await this.authed(`/owner/${pathUser(this.username)}/device/`, {
      what: 'Blueair (historical) device list',
    });
    if (!Array.isArray(list)) {
      throw new BlueairError(ERROR_KINDS.HTTP, 'Blueair (historical) device list: unexpected');
    }
    return list.filter((device) => device && typeof device.uuid === 'string');
  }

  /** Model, firmware, compatibility of one device. */
  info(uuid) {
    return this.authed(`/device/${encodeURIComponent(uuid)}/info/`, {
      what: 'Blueair (historical) device info',
    });
  }

  /** The attributes of one device, as `{ name: currentValue }`. */
  async attributes(uuid) {
    const list = await this.authed(`/device/${encodeURIComponent(uuid)}/attributes/`, {
      what: 'Blueair (historical) device state',
    });
    const attributes = {};
    for (const item of Array.isArray(list) ? list : []) {
      if (item && typeof item.name === 'string') {
        attributes[item.name] = item.currentValue;
      }
    }
    return attributes;
  }

  /** The latest data point: `{ sensors: [...], datapoints: [[time, ...values]] }`. */
  latestDataPoint(uuid) {
    return this.authed(`/device/${encodeURIComponent(uuid)}/datapoint/0/last/0/`, {
      what: 'Blueair (historical) sensors',
    });
  }

  /**
   * Write one attribute, with the bodies blueair_api sends.
   * @param {string} uuid
   * @param {'fan_speed'|'mode'|'brightness'|'child_lock'} name
   * @param {string|number} value
   */
  async setAttribute(uuid, name, value) {
    const { route, body } = LEGACY_WRITES[name](value);
    await this.authed(`/device/${encodeURIComponent(uuid)}/attribute/${route}/`, {
      method: 'POST',
      what: `Blueair (historical) command ${name}`,
      json: { ...body, scope: 'device', name, uuid: String(uuid) },
    });
  }
}

// Route and body of each writable attribute.
const LEGACY_WRITES = {
  // "0" to "3"; "0" stops the fan.
  fan_speed: (value) => ({
    route: 'fanspeed',
    body: { currentValue: String(value), defaultValue: String(value) },
  }),
  // "auto" or "manual".
  mode: (value) => ({ route: 'mode', body: { currentValue: String(value) } }),
  // 0 to 4, sent as a number.
  brightness: (value) => ({ route: 'brightness', body: { currentValue: Number(value) } }),
  // "1" locked, "0" unlocked.
  child_lock: (value) => ({ route: 'child_lock', body: { currentValue: String(value) } }),
};
