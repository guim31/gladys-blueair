// -----------------------------------------------------------------------------
// Client of the current Blueair cloud ("AWS" API), the one the Blueair app
// uses for every purifier sold since about 2020 (Blue Pure Max, Protect,
// DustMagnet, Signature, HealthProtect...).
//
// Protocol, as implemented by dahlb/blueair_api (MIT, see the README credits):
//   1. Gigya (SAP Customer Data Cloud) logs the account in: accounts.login
//      gives a session token and secret, accounts.getJWT trades them for a
//      short-lived id token (~5 minutes);
//   2. BlueCloud (AWS API Gateway) trades that id token for an access token
//      (POST /c/login), whose `username` claim is the user id of the paths;
//   3. GET /c/registered-devices lists the devices, POST /c/<user>/r/initial
//      reads one device (schema, states, latest sensor values), GET
//      /c/<user>/r/telemetry/5m/historical its 5-minute sensor averages, and
//      POST /c/<device>/a/<attribute> writes one attribute.
//
// The keys below are the public application keys of the Blueair app, the same
// for every user (they are in the MIT library): nothing secret. The session
// and the access token are kept by the caller (under /data, src/store.js) so
// a restart does not log the account in again.
// -----------------------------------------------------------------------------

import { BlueairError, ERROR_KINDS, networkError, parseJson, statusError } from './errors.js';

export const AWS_REGIONS = Object.freeze({
  us: {
    gigya: 'accounts.us1.gigya.com',
    apiKey: '3_-xUbbrIY8QCbHDWQs1tLXE-CZBQ50SGElcOY5hF1euE11wCoIlNbjMGAFQ6UwhMY',
    restApiId: 'on1keymlmh',
    awsRegion: 'us-east-2.amazonaws.com',
  },
  eu: {
    gigya: 'accounts.eu1.gigya.com',
    apiKey: '3_qRseYzrUJl1VyxvSJANalu_kNgQ83swB1B9uzgms58--5w1ClVNmrFdsDnWVQQCl',
    restApiId: 'hkgmr8v960',
    awsRegion: 'eu-west-1.amazonaws.com',
  },
  au: {
    gigya: 'accounts.au1.gigya.com',
    apiKey: '3_Z2N0mIFC6j2fx1z2sq76R3pwkCMaMX2y9btPb0_PgI_3wfjSJoofFnBbxbtuQksN',
    // Australian accounts are served by the European BlueCloud.
    restApiId: 'hkgmr8v960',
    awsRegion: 'eu-west-1.amazonaws.com',
  },
  cn: {
    gigya: 'accounts.cn1.sapcdm.cn',
    apiKey: '3_h3UEfJnA-zDpFPR9L4412HO7Mz2VVeN4wprbWYafPN1gX0kSnLcZ9VSfFi7bEIIU',
    restApiId: 'ftbkyp79si',
    awsRegion: 'cn-north-1.amazonaws.com.cn',
  },
});

// The sensors the telemetry route is asked for (the list of blueair_api).
export const TELEMETRY_SENSORS = ['pm1', 'pm2_5', 'pm10', 'tVOC', 'hcho', 'h', 't', 'fsp0'];

// Gigya error codes (https://help.sap.com/docs/SAP_CUSTOMER_DATA_CLOUD, "Response Codes").
const GIGYA = Object.freeze({
  PENDING_REGISTRATION: 206001,
  INVALID_CREDENTIALS: 403042,
  ACCOUNT_LOCKED: [403120, 403041, 403047, 401041],
});

// An access token is renewed this long before it expires.
const ACCESS_MARGIN_MS = 5 * 60_000;

/** The claims of a JWT, without checking its signature (it is ours to send, not to trust). */
export function jwtClaims(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export class AwsClient {
  /**
   * @param {object} options
   * @param {string} options.username e-mail of the Blueair account
   * @param {string} options.password
   * @param {string} options.region one of AWS_REGIONS
   * @param {Function} options.request HTTP seam (src/blueair/http.js)
   * @param {() => number} [options.now]
   * @param {object|null} [options.tokens] tokens saved by a previous run
   * @param {(tokens: object) => void} [options.onTokens] called when the tokens change
   * @param {boolean} [options.completeRegistration] finish a pending Gigya registration like the app does
   * @param {(message: string) => void} [options.onNotice] one-off lifecycle notices
   */
  constructor({
    username,
    password,
    region,
    request,
    now = () => Date.now(),
    tokens = null,
    onTokens = () => {},
    completeRegistration = true,
    onNotice = () => {},
  }) {
    const endpoints = AWS_REGIONS[region];
    if (!endpoints) {
      throw new Error(`Unknown Blueair region ${region}`);
    }
    this.username = username;
    this.password = password;
    this.endpoints = endpoints;
    this.request = request;
    this.now = now;
    this.onTokens = onTokens;
    this.completeRegistration = completeRegistration;
    this.onNotice = onNotice;
    this.tokens = {
      sessionToken: tokens?.sessionToken ?? null,
      sessionSecret: tokens?.sessionSecret ?? null,
      accessToken: tokens?.accessToken ?? null,
      accessExpiresAt: tokens?.accessExpiresAt ?? 0,
      userId: tokens?.userId ?? null,
    };
    /** A renewal in progress: concurrent callers wait for the same one. */
    this.renewing = null;
  }

  get restBase() {
    return `https://${this.endpoints.restApiId}.execute-api.${this.endpoints.awsRegion}/prod/c`;
  }

  // --- Gigya ------------------------------------------------------------------

  async gigya(path, form, what) {
    let response;
    try {
      response = await this.request(`https://${this.endpoints.gigya}/${path}`, {
        method: 'POST',
        form: { apikey: this.endpoints.apiKey, ...form },
      });
    } catch (err) {
      throw networkError(err, what);
    }
    if (response.status !== 200) {
      throw statusError(response.status, what);
    }
    return parseJson(response.body, what);
  }

  /** accounts.login: a new Gigya session. */
  async loginSession() {
    let answer = await this.gigya(
      'accounts.login',
      { loginID: this.username, password: this.password, targetEnv: 'mobile' },
      'Blueair login',
    );
    if (answer.errorCode === GIGYA.PENDING_REGISTRATION) {
      await this.finishRegistration(answer);
      answer = await this.gigya(
        'accounts.login',
        { loginID: this.username, password: this.password, targetEnv: 'mobile' },
        'Blueair login',
      );
    }
    this.checkLogin(answer);
    const { sessionToken, sessionSecret } = answer.sessionInfo ?? {};
    if (!sessionToken || !sessionSecret) {
      throw new BlueairError(ERROR_KINDS.HTTP, 'Blueair login: no session in the answer');
    }
    this.tokens.sessionToken = sessionToken;
    this.tokens.sessionSecret = sessionSecret;
  }

  checkLogin(answer) {
    const code = answer.errorCode ?? 0;
    if (code === 0) {
      return;
    }
    if (code === GIGYA.INVALID_CREDENTIALS) {
      throw new BlueairError(ERROR_KINDS.AUTH, 'Blueair login: e-mail or password refused');
    }
    if (GIGYA.ACCOUNT_LOCKED.includes(code)) {
      throw new BlueairError(ERROR_KINDS.LOCKED, `Blueair login: account locked (${code})`);
    }
    if (code === GIGYA.PENDING_REGISTRATION) {
      throw new BlueairError(ERROR_KINDS.REGISTRATION, 'Blueair login: registration pending');
    }
    const status = Number(answer.statusCode);
    if (status >= 500) {
      throw new BlueairError(ERROR_KINDS.UNREACHABLE, `Blueair login: error ${code}`);
    }
    if (status === 429) {
      throw new BlueairError(ERROR_KINDS.RATE_LIMIT, `Blueair login: error ${code}`);
    }
    throw new BlueairError(ERROR_KINDS.AUTH, `Blueair login: refused (${code})`);
  }

  /**
   * Gigya refuses the login of an account created before Blueair made the
   * profile name mandatory (2026-09-22, dahlb/ha_blueair#421) until the
   * registration is completed; the Blueair app completes it silently with the
   * name of the profile, so does this client.
   */
  async finishRegistration(answer) {
    const profile = answer.profile ?? {};
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    if (!this.completeRegistration || !answer.regToken || !name) {
      throw new BlueairError(
        ERROR_KINDS.REGISTRATION,
        'Blueair login: registration pending, open the Blueair app once',
      );
    }
    this.onNotice('The Blueair account was pending registration: completed, as the app does');
    for (const [path, form] of [
      ['accounts.setAccountInfo', { regToken: answer.regToken, profile: JSON.stringify({ name }) }],
      ['accounts.finalizeRegistration', { regToken: answer.regToken }],
    ]) {
      const step = await this.gigya(path, form, 'Blueair registration');
      if ((step.errorCode ?? 0) !== 0) {
        throw new BlueairError(
          ERROR_KINDS.REGISTRATION,
          `Blueair registration: refused (${step.errorCode})`,
        );
      }
    }
  }

  /** accounts.getJWT: an id token from the session. Throws SESSION when it is no longer valid. */
  async idToken() {
    const answer = await this.gigya(
      'accounts.getJWT',
      {
        oauth_token: this.tokens.sessionToken,
        secret: this.tokens.sessionSecret,
        targetEnv: 'mobile',
      },
      'Blueair session',
    );
    if ((answer.errorCode ?? 0) !== 0 || !answer.id_token) {
      const status = Number(answer.statusCode);
      if (status >= 500) {
        throw new BlueairError(
          ERROR_KINDS.UNREACHABLE,
          `Blueair session: error ${answer.errorCode}`,
        );
      }
      throw new BlueairError(ERROR_KINDS.SESSION, `Blueair session: refused (${answer.errorCode})`);
    }
    return answer.id_token;
  }

  // --- BlueCloud access token ---------------------------------------------------

  /** POST /c/login: an access token from an id token. */
  async exchange(idToken) {
    let response;
    try {
      response = await this.request(`${this.restBase}/login`, {
        method: 'POST',
        headers: { idtoken: idToken, authorization: `Bearer ${idToken}` },
      });
    } catch (err) {
      throw networkError(err, 'Blueair cloud login');
    }
    // A refused id token is a 400 "Token invalid or Request Timeout" (seen on
    // the real BlueCloud): a session problem, worth a new login.
    if (response.status === 400) {
      throw new BlueairError(ERROR_KINDS.SESSION, 'Blueair cloud login: id token refused');
    }
    if (response.status !== 200) {
      throw statusError(response.status, 'Blueair cloud login');
    }
    const answer = parseJson(response.body, 'Blueair cloud login');
    const accessToken = answer.access_token;
    const claims = jwtClaims(accessToken ?? '');
    if (!accessToken || !claims.username) {
      throw new BlueairError(ERROR_KINDS.HTTP, 'Blueair cloud login: no access token');
    }
    this.tokens.accessToken = accessToken;
    this.tokens.userId = claims.username;
    // Without an expiry, the token is used until refused.
    this.tokens.accessExpiresAt = Number.isFinite(claims.exp) ? claims.exp * 1000 : 0;
  }

  /**
   * A fresh access token: from the saved session when there is one (no
   * password sent), else from a new login.
   * @param {{ relogin?: boolean }} [options] relogin: skip the saved session
   */
  renew({ relogin = false } = {}) {
    this.renewing ??= (async () => {
      try {
        if (!relogin && this.tokens.sessionToken && this.tokens.sessionSecret) {
          try {
            await this.exchange(await this.idToken());
            return;
          } catch (err) {
            if (err.kind !== ERROR_KINDS.SESSION) {
              throw err;
            }
          }
        }
        await this.loginSession();
        await this.exchange(await this.idToken());
      } catch (err) {
        if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.LOCKED) {
          // The saved session belongs to credentials that no longer work.
          this.forgetTokens();
        }
        throw err;
      } finally {
        this.onTokens({ ...this.tokens });
      }
    })().finally(() => {
      this.renewing = null;
    });
    return this.renewing;
  }

  forgetTokens() {
    this.tokens = {
      sessionToken: null,
      sessionSecret: null,
      accessToken: null,
      accessExpiresAt: 0,
      userId: null,
    };
  }

  hasFreshAccess() {
    const { accessToken, accessExpiresAt } = this.tokens;
    return (
      accessToken !== null &&
      this.tokens.userId !== null &&
      (accessExpiresAt === 0 || accessExpiresAt - ACCESS_MARGIN_MS > this.now())
    );
  }

  /** Log in (or reuse the saved session) now: the "Test the connection" path. */
  async connect() {
    if (!this.hasFreshAccess()) {
      await this.renew();
    }
  }

  /**
   * A BlueCloud request with the access token; a refused token is renewed
   * once, then the request is sent again.
   */
  async rest(method, path, { json, query, what }) {
    for (let attempt = 0; ; attempt += 1) {
      if (!this.hasFreshAccess()) {
        await this.renew();
      }
      const url = new URL(`${this.restBase}${path.replace('{user}', this.tokens.userId)}`);
      for (const [key, value] of Object.entries(query ?? {})) {
        for (const item of [value].flat()) {
          url.searchParams.append(key, String(item));
        }
      }
      let response;
      try {
        response = await this.request(url.toString(), {
          method,
          headers: { authorization: `Bearer ${this.tokens.accessToken}` },
          json,
        });
      } catch (err) {
        throw networkError(err, what);
      }
      // A JSON body may carry its own status code (blueair_api does the same).
      let answer;
      try {
        answer = JSON.parse(response.body);
      } catch {
        answer = undefined;
      }
      const status =
        answer && typeof answer === 'object' && Number.isInteger(answer.statusCode)
          ? answer.statusCode
          : response.status;
      if (status >= 200 && status < 300) {
        return answer;
      }
      const error = statusError(status, what);
      if (error.kind === ERROR_KINDS.SESSION && attempt === 0) {
        // The access token was refused before its expiry: a new one, then once more.
        await this.renew();
        continue;
      }
      throw error;
    }
  }

  // --- Devices -------------------------------------------------------------------

  /** @returns {Promise<Array<{ uuid: string, name: string, mac: string, type: string }>>} */
  async devices() {
    const answer = await this.rest('GET', '/registered-devices', { what: 'Blueair device list' });
    if (!answer || !Array.isArray(answer.devices)) {
      throw new BlueairError(ERROR_KINDS.HTTP, 'Blueair device list: unexpected answer');
    }
    return answer.devices.filter((device) => device && typeof device.uuid === 'string');
  }

  /** The schema, states and latest sensor values of one device. */
  async deviceInfo(uuid) {
    const answer = await this.rest('POST', '/{user}/r/initial', {
      what: 'Blueair device state',
      json: {
        deviceconfigquery: [{ id: uuid, r: { r: ['sensors'] } }],
        includestates: true,
      },
    });
    const info = answer?.deviceInfo?.[0];
    if (!info || typeof info !== 'object') {
      throw new BlueairError(ERROR_KINDS.HTTP, 'Blueair device state: unexpected answer');
    }
    return info;
  }

  /** The 5-minute sensor averages of one device over [from, to] (epoch seconds). */
  async telemetry(uuid, from, to) {
    const answer = await this.rest('GET', '/{user}/r/telemetry/5m/historical', {
      what: 'Blueair sensor history',
      query: { did: uuid, from, to, s: TELEMETRY_SENSORS },
    });
    return Array.isArray(answer) ? answer : [];
  }

  /**
   * Write one attribute: `verb` is `v` for a number, `vb` for a boolean.
   * @param {string} uuid
   * @param {string} name attribute (standby, fanspeed, automode...)
   * @param {'v'|'vb'} verb
   * @param {number|boolean} value
   */
  async setAttribute(uuid, name, verb, value) {
    await this.rest('POST', `/${encodeURIComponent(uuid)}/a/${encodeURIComponent(name)}`, {
      what: `Blueair command ${name}`,
      json: { n: name, [verb]: value },
    });
  }
}
