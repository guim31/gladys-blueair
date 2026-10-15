// -----------------------------------------------------------------------------
// The Blueair hub: the account (current and historical clouds), one record
// per device of the account, read on a timer of the container (the interval
// chosen in the configuration), its states published to Gladys when they
// change, the "filter to replace" scene event fired once per filter, and the
// commands of the device features, the widget and the scene action.
//
// Gladys never polls these devices (should_poll: false): the core cannot be
// trusted to (GladysAssistant/Gladys#3198), and the interval goes up to 5
// minutes, beyond the fixed list of its scheduler. onPoll stays as a fallback
// (pollDevice).
//
// What one cycle costs, per device: one request on the current cloud (POST
// /r/initial: states and, for some models, the latest sensor values), plus
// the 5-minute sensor averages at most every 5 minutes for the models that
// only report them there. On the historical cloud: one request, plus the
// data point at most every 5 minutes (the server refreshes it at that pace).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { AwsClient } from './blueair/aws.js';
import { BlueairError, ERROR_KINDS } from './blueair/errors.js';
import { LegacyClient } from './blueair/legacy.js';
import {
  API,
  COMBO_WRITE,
  HUMIDIFIER_SPEEDS,
  MODES,
  MODE_FAMILIES,
  SIGNATURE_WRITE,
  awsSensorReadings,
  legacySensorReadings,
  parseAwsDevice,
  parseLegacyDevice,
  parseTelemetry,
} from './blueair/model.js';
import { isConfigured } from './config.js';
import {
  FEATURE_KEYS,
  buildDevice,
  deviceIds,
  deviceStates,
  featureKeyOf,
  filterToReplace,
} from './devices.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  labelled,
  perLanguage,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'blueair-hub' });

export const WIDGET_KEY = 'purifier';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({ FILTER: 'filter_to_replace' });

export const HUB_TIMINGS = {
  // Sensor averages are computed every 5 minutes on the Blueair side.
  sensorsMs: 5 * 60_000,
  // Window of the telemetry request: the latest 5-minute averages.
  telemetryWindowMs: 60 * 60_000,
  // Sensor values this recent mean the device is online, whatever the cloud says.
  aliveMs: 20 * 60_000,
  // New devices added in the Blueair app are looked for at this pace.
  discoveryMs: 6 * 60 * 60_000,
  // A 429 from Blueair: no request for that long.
  rateLimitPauseMs: 10 * 60_000,
  // Night mode switched off: the device restores its speed in the cloud
  // first, a speed written sooner is overwritten (ha_blueair).
  nightModeSettleMs: 2000,
  // An unchanged state is sent again this often (the front shows "no recent
  // value" past 48 h).
  heartbeatMs: 6 * 60 * 60_000,
};

// On Signature devices every apsubmode write is paired with this fan speed,
// the lowest manual one, like the Blueair app does (ha_blueair).
const SIGNATURE_SPEED_RESET = 11;

const accountKey = (config) =>
  createHash('sha256')
    .update(`${config.username.toLowerCase()}\n${config.region}`)
    .digest('hex')
    .slice(0, 16);

const credentials = (config) =>
  createHash('sha256')
    .update(JSON.stringify([config.username, config.password, config.region]))
    .digest('hex');

// Errors that stop every request until the user changes the configuration
// or asks for a test: retrying a refused password locks the account.
const BLOCKING_KINDS = [ERROR_KINDS.AUTH, ERROR_KINDS.LOCKED, ERROR_KINDS.REGISTRATION];

export class BlueairHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} options.request HTTP seam (src/blueair/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({ gladys, store, request, timers = true, timings, now, sleep }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.config = null;
    this.aws = null;
    this.legacy = null;
    this.credentials = null;
    /** @type {Map<string, object>} device records, by device external id */
    this.records = new Map();
    /** The account-level problem of the moment (a BlueairError), null when fine. */
    this.accountError = null;
    /** A refused login, kept until the configuration changes. */
    this.blocked = null;
    this.discoveredAt = null;
    this.legacyAccount = false;
    this.legacyRefused = false;
    this.pausedUntil = 0;
    this.transports = new Map();
    this.connection = null;
    this.saved = { account: null, aws: null, legacy: null, filterAlerts: {} };
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged as warnings, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (account connected, lost, back, devices
  // found, user commands). A problem that repeats every cycle is logged once
  // at its own level, then at debug until it clears. LOG_LEVEL=debug shows
  // everything. Never a password, a token or a device secret.

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(`${message} (again)`);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      account: typeof saved.account === 'string' ? saved.account : null,
      aws: saved.aws && typeof saved.aws === 'object' ? saved.aws : null,
      legacy: saved.legacy && typeof saved.legacy === 'object' ? saved.legacy : null,
      filterAlerts:
        saved.filterAlerts && typeof saved.filterAlerts === 'object' ? saved.filterAlerts : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const changed = credentials(config) !== this.credentials;
    if (changed) {
      this.credentials = credentials(config);
      this.blocked = null;
      this.accountError = null;
      this.pausedUntil = 0;
      this.records.clear();
      this.discoveredAt = null;
      this.createClients(config);
    } else if (previous && previous.language !== config.language) {
      // New feature names only reach devices created from now on.
      this.discoveredAt = null;
    }
    await this.cycle({ discover: true });
    this.schedulePoll();
  }

  createClients(config) {
    if (!isConfigured(config)) {
      this.aws = null;
      this.legacy = null;
      return;
    }
    const account = accountKey(config);
    if (this.saved.account !== account) {
      // Another account: the saved tokens and filter alerts are not its own.
      this.saved = { account, aws: null, legacy: null, filterAlerts: {} };
      this.store.save(this.saved);
    }
    this.aws = new AwsClient({
      username: config.username,
      password: config.password,
      region: config.region,
      request: this.request,
      now: this.now,
      tokens: this.saved.aws,
      onTokens: (tokens) => {
        this.saved.aws = tokens;
        this.store.save(this.saved);
      },
      onNotice: (message) => logger.info(message),
    });
    this.legacyRefused = false;
    this.legacy = new LegacyClient({
      username: config.username,
      password: config.password,
      request: this.request,
      tokens: this.saved.legacy,
      onTokens: (tokens) => {
        this.saved.legacy = tokens;
        this.store.save(this.saved);
      },
    });
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !isConfigured(this.config)) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.cycle();
        this.resolved('cycle');
      } catch (err) {
        this.problem('cycle', `Refresh failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  // --- The reading cycle -------------------------------------------------------

  /**
   * Look for the devices when due, read every device, publish what changed.
   * A plain call shares the cycle in progress; a discovery (new
   * configuration, Scan, test) waits for it, then runs its own.
   */
  cycle({ discover = false } = {}) {
    if (this.polling && !discover) {
      return this.polling;
    }
    const previous = this.polling ?? Promise.resolve();
    const tracked = previous
      .catch(() => {})
      .then(() => this.runCycle({ discover }))
      .finally(() => {
        if (this.polling === tracked) {
          this.polling = null;
        }
      });
    this.polling = tracked;
    return tracked;
  }

  async runCycle({ discover }) {
    if (!isConfigured(this.config)) {
      this.records.clear();
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    if (this.blocked || this.now() < this.pausedUntil) {
      logger.debug('Blueair requests suspended: skipped');
      await this.afterChanges(false);
      return;
    }
    const due =
      discover ||
      this.discoveredAt === null ||
      this.now() - this.discoveredAt >= this.timings.discoveryMs;
    let widgetChanged = false;
    try {
      if (due) {
        await this.discover();
        widgetChanged = true;
      }
      const results = await Promise.all(
        [...this.records.values()].map((record) => this.readDevice(record)),
      );
      widgetChanged ||= results.some(Boolean);
      this.accountOk();
    } catch (err) {
      if (!(err instanceof BlueairError)) {
        throw err;
      }
      widgetChanged = this.accountFailed(err) || widgetChanged;
    }
    await this.afterChanges(widgetChanged);
  }

  accountOk() {
    if (this.accountError) {
      logger.info('Blueair account: connection restored');
    }
    this.accountError = null;
  }

  /** @returns {boolean} whether the widget shows something new */
  accountFailed(err) {
    const wasKind = this.accountError?.kind;
    this.accountError = err;
    if (wasKind !== err.kind) {
      logger.warn(`Blueair account: ${err.message}`);
    } else {
      logger.debug(`Blueair account: ${err.message} (again)`);
    }
    if (BLOCKING_KINDS.includes(err.kind)) {
      this.blocked = err;
      logger.warn('Blueair requests stopped until the configuration changes');
    }
    if (err.kind === ERROR_KINDS.RATE_LIMIT) {
      this.pausedUntil = this.now() + this.timings.rateLimitPauseMs;
    }
    for (const record of this.records.values()) {
      record.reachable = false;
    }
    return wasKind !== err.kind;
  }

  // --- Devices -----------------------------------------------------------------

  /** Both clouds' device lists, read again; the records follow. */
  async discover() {
    const found = new Map();
    const listed = await this.aws.devices();
    for (const entry of listed) {
      const externalId = deviceIds(this.gladys, entry.uuid).device;
      let info;
      try {
        info = await this.aws.deviceInfo(entry.uuid);
      } catch (err) {
        // One device answering oddly does not hide the others; it is kept as
        // it was when already known, and read again at the next cycle.
        if (!(err instanceof BlueairError) || err.kind !== ERROR_KINDS.HTTP) {
          throw err;
        }
        this.problem(`device:${externalId}`, `${entry.name ?? 'Blueair device'}: ${err.message}`);
        const known = this.records.get(externalId);
        if (known) {
          found.set(externalId, { parsed: { profile: known.profile }, listed: entry });
        }
        continue;
      }
      found.set(externalId, { parsed: parseAwsDevice(info, entry), info, listed: entry });
    }
    const legacyFound = await this.discoverLegacy();
    const awsMacs = new Set([...found.values()].map(({ parsed }) => parsed.profile.mac));
    for (const [externalId, parsed] of legacyFound) {
      // A device listed by both clouds is driven through the current one.
      if (!parsed.profile.mac || !awsMacs.has(parsed.profile.mac)) {
        found.set(externalId, { parsed });
      }
    }

    const before = new Set(this.records.keys());
    const records = new Map();
    for (const [externalId, { parsed, info, listed }] of found) {
      const record = this.records.get(externalId) ?? this.newRecord(externalId, parsed.profile);
      record.profile = parsed.profile;
      record.listed = listed ?? record.listed;
      if (info) {
        this.applyAws(record, parsed);
        record.freshInfo = true;
      } else if (parsed.profile.api === API.LEGACY) {
        // Just read by the discovery (unless the historical cloud failed and
        // these are the previous values): no second request in the same cycle.
        record.legacyFirst = parsed.stale ? null : parsed;
      }
      records.set(externalId, record);
    }
    this.records = records;
    this.discoveredAt = this.now();
    const added = [...records.keys()].filter((id) => !before.has(id)).length;
    if (added > 0 || before.size !== records.size) {
      logger.info(
        `Blueair account: ${records.size} device(s) found` +
          (this.legacyAccount ? ' (with the older Blueair cloud)' : ''),
      );
    }
    await this.publishDevices();
  }

  /** The devices of the historical cloud; none when it does not know the account. */
  async discoverLegacy() {
    const found = new Map();
    if (this.legacyRefused) {
      // Refused once with the current credentials: no device of that
      // generation, the historical cloud is not asked again.
      return this.keepLegacy(found);
    }
    try {
      if (!(await this.legacy.connect())) {
        this.legacyAccount = false;
        logger.debug('Older Blueair cloud: no account, no device of that generation');
        return found;
      }
      const listed = await this.legacy.devices();
      for (const entry of listed) {
        const [info, attributes] = await Promise.all([
          this.legacy.info(entry.uuid),
          this.legacy.attributes(entry.uuid),
        ]);
        found.set(
          deviceIds(this.gladys, entry.uuid).device,
          parseLegacyDevice(info ?? {}, attributes, entry),
        );
      }
      this.legacyAccount = found.size > 0;
      this.resolved('legacy', 'Older Blueair cloud: answers again');
    } catch (err) {
      if (!(err instanceof BlueairError)) {
        throw err;
      }
      // The current cloud accepted the account (it is asked first): a refusal
      // here only means no device of that generation — the historical cloud
      // answers an unknown e-mail with a home host, then refuses its login
      // (probed 2026-10-15), and ha_blueair reads any refusal the same way.
      // Not an error, and not asked again until the credentials change.
      if (err.kind === ERROR_KINDS.AUTH) {
        this.legacyRefused = true;
        this.legacyAccount = false;
        logger.debug(`Older Blueair cloud: ${err.message}: no device of that generation`);
      } else {
        this.problem('legacy', `Older Blueair cloud: ${err.message}`);
      }
      this.keepLegacy(found);
    }
    return found;
  }

  /** The devices the historical cloud held: kept, unreachable, until it answers again. */
  keepLegacy(found) {
    for (const [externalId, record] of this.records) {
      if (record.profile.api === API.LEGACY) {
        record.reachable = false;
        found.set(externalId, { profile: record.profile, readings: record.readings, stale: true });
      }
    }
    return found;
  }

  newRecord(externalId, profile) {
    return {
      externalId,
      profile,
      readings: null,
      sensorValues: {},
      sensorTime: null,
      sensorsReadAt: 0,
      reachable: null,
      online: null,
      lastSpeed: null,
      freshInfo: false,
      legacyFirst: null,
    };
  }

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record.profile, this.config.language),
    );
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.resolved('discovered');
    } catch (err) {
      this.problem('discovered', `Devices refused by Gladys: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: look for the devices again, read them. */
  async rediscover() {
    if (!this.blocked) {
      await this.cycle({ discover: true });
    } else {
      await this.publishDevices();
    }
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const record = this.records.get(device.external_id);
    if (!record) {
      return;
    }
    await this.publishStates(record, { force: true });
    await this.publishTransports({ force: true });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll fallback): the cycle covers every device. */
  async pollDevice(device) {
    if (this.records.has(device.external_id)) {
      await this.cycle();
    }
  }

  // --- Reading one device -----------------------------------------------------------

  /**
   * Read one device and publish what changed. A problem of the account (or of
   * the whole current cloud) is thrown to the cycle; a problem of this device
   * only (an odd answer, the historical cloud failing) is logged once and
   * marks it unreachable.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  async readDevice(record) {
    const before = JSON.stringify([record.readings, record.online, record.reachable]);
    const problemKey = `device:${record.externalId}`;
    try {
      if (record.profile.api === API.AWS) {
        await this.readAws(record);
      } else {
        await this.readLegacy(record);
      }
      record.reachable = true;
      this.resolved(problemKey, `${record.profile.name}: answers again`);
    } catch (err) {
      if (!(err instanceof BlueairError)) {
        throw err;
      }
      if (record.profile.api === API.AWS && err.kind !== ERROR_KINDS.HTTP) {
        throw err;
      }
      record.reachable = false;
      this.problem(problemKey, `${record.profile.name}: ${err.message}`);
    }
    if (record.readings) {
      this.updateOnline(record);
      await this.publishStates(record);
      await this.filterTransition(record);
    }
    return JSON.stringify([record.readings, record.online, record.reachable]) !== before;
  }

  async readAws(record) {
    if (record.freshInfo) {
      // Just read by the discovery: no second request in the same cycle.
      record.freshInfo = false;
    } else {
      const info = await this.aws.deviceInfo(record.profile.uuid);
      const parsed = parseAwsDevice(info, record.listed ?? { uuid: record.profile.uuid });
      // A firmware update can add a control or a sensor: the device follows.
      if (JSON.stringify(parsed.profile) !== JSON.stringify(record.profile)) {
        record.profile = parsed.profile;
        await this.publishDevices();
      }
      this.applyAws(record, parsed);
    }
    const wanted = Object.values(record.profile.sensorKeys).filter(Boolean);
    const missing = wanted.some((key) => record.sensorValues[key] === undefined);
    const stale =
      record.sensorTime === null || this.now() - record.sensorTime * 1000 > this.timings.sensorsMs;
    if (
      wanted.length > 0 &&
      (missing || stale) &&
      this.now() - record.sensorsReadAt >= this.timings.sensorsMs
    ) {
      record.sensorsReadAt = this.now();
      const to = Math.floor(this.now() / 1000);
      const from = to - Math.floor(this.timings.telemetryWindowMs / 1000);
      const telemetry = parseTelemetry(await this.aws.telemetry(record.profile.uuid, from, to));
      this.mergeSensors(record, telemetry);
    }
    record.readings = {
      ...record.readings,
      ...awsSensorReadings(record.profile, record.sensorValues),
    };
  }

  applyAws(record, parsed) {
    record.readings = { ...parsed.readings };
    this.mergeSensors(record, parsed.sensors);
    record.readings = {
      ...record.readings,
      ...awsSensorReadings(record.profile, record.sensorValues),
    };
    if (record.readings.fanSpeed > 0) {
      record.lastSpeed = record.readings.fanSpeed;
    }
  }

  /** Keep the newest value of each sensor. */
  mergeSensors(record, { values, time }) {
    if (time === null || Object.keys(values).length === 0) {
      return;
    }
    if (record.sensorTime !== null && time < record.sensorTime) {
      // Older than what is known: only fill the gaps.
      for (const [key, value] of Object.entries(values)) {
        record.sensorValues[key] ??= value;
      }
      return;
    }
    record.sensorValues = { ...record.sensorValues, ...values };
    record.sensorTime = time;
  }

  async readLegacy(record) {
    let parsed = record.legacyFirst;
    record.legacyFirst = null;
    if (!parsed) {
      const attributes = await this.legacy.attributes(record.profile.uuid);
      parsed = parseLegacyDevice({ compatibility: record.profile.hardware }, attributes, {
        uuid: record.profile.uuid,
      });
    }
    const sensors = { ...(record.readings ?? {}) };
    record.readings = { ...parsed.readings };
    for (const key of ['pm25', 'pm10', 'voc', 'co2', 'temperature', 'humidity']) {
      record.readings[key] = sensors[key] ?? null;
    }
    if (record.profile.hasSensors && this.now() - record.sensorsReadAt >= this.timings.sensorsMs) {
      record.sensorsReadAt = this.now();
      const { readings, time } = legacySensorReadings(
        record.profile,
        await this.legacy.latestDataPoint(record.profile.uuid),
      );
      Object.assign(record.readings, readings);
      record.sensorTime = time;
    }
    if (record.readings.fanSpeed > 0) {
      record.lastSpeed = record.readings.fanSpeed;
    }
  }

  updateOnline(record) {
    const recent =
      record.sensorTime !== null && this.now() - record.sensorTime * 1000 <= this.timings.aliveMs;
    const reported = record.readings.reportedOnline;
    const online = record.reachable === true && (reported !== false || recent);
    if (record.online !== null && record.online !== online) {
      logger.info(`${record.profile.name}: ${online ? 'back online' : 'offline'}`);
    }
    record.online = online;
    record.readings.online = online;
  }

  // --- Scene event -----------------------------------------------------------------

  /** Announce each filter to replace once, across restarts; forget it once replaced. */
  async filterTransition(record) {
    const replace = filterToReplace(record.readings, this.config.filterThreshold);
    const alerts = this.saved.filterAlerts;
    const key = record.profile.uuid;
    if (replace === false && alerts[key]) {
      delete alerts[key];
      this.store.save(this.saved);
      logger.info(`${record.profile.name}: filter replaced`);
      return;
    }
    if (replace !== true || alerts[key]) {
      return;
    }
    alerts[key] = true;
    this.store.save(this.saved);
    logger.info(`${record.profile.name}: filter to replace`);
    try {
      await this.gladys.publishSceneEvent(TRIGGERS.FILTER, {
        device: record.externalId,
        device_name: record.profile.name,
        model: record.profile.model,
        filter_life: record.readings.filterLife ?? null,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${TRIGGERS.FILTER} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of a device the user added; the others would be dropped by Gladys. */
  async publishStates(record, { force = false } = {}) {
    if (!record.readings) {
      return;
    }
    const created = (this.gladys.devices ?? []).some(
      (device) => device.external_id === record.externalId,
    );
    if (!created) {
      return;
    }
    if (force) {
      this.gladys.forgetPublishedStates(record.externalId);
    }
    const states = deviceStates(this.gladys, record.profile, record.readings, {
      filterThreshold: this.config.filterThreshold,
    });
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${record.profile.name} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports({ force = false } = {}) {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.reachable === null) {
        continue;
      }
      const transport =
        record.reachable && record.online ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
      if (force || this.transports.get(record.externalId) !== transport) {
        entries.push({ external_id: record.externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!isConfigured(this.config)) {
      return { connected: false, message: CONNECTION_TEXT.notConfigured };
    }
    const error = this.blocked ?? this.accountError;
    if (error) {
      return { connected: false, message: ERROR_TEXT[error.kind] ?? ERROR_TEXT.http };
    }
    if (this.discoveredAt !== null && this.records.size === 0) {
      return { connected: true, message: CONNECTION_TEXT.noDevices };
    }
    return { connected: this.discoveredAt !== null };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------------

  language() {
    return this.config?.language;
  }

  fail(text) {
    return new Error(pick(text, this.language()));
  }

  /** The record of a device that can take commands now. */
  controllable(externalId) {
    const record = this.records.get(externalId);
    if (!record) {
      throw this.fail(ACTION_TEXT.unknownDevice);
    }
    if (!record.profile.controllable) {
      throw this.fail(ACTION_TEXT.readOnly);
    }
    if (this.blocked || !this.aws) {
      throw this.fail(ACTION_TEXT.notConnected);
    }
    return record;
  }

  /** A device feature changed in Gladys (dashboard, scene, voice). */
  async setValue(device, feature, value) {
    const record = this.controllable(device.external_id);
    const key = featureKeyOf(this.gladys, record.profile.uuid, feature.external_id);
    switch (key) {
      case FEATURE_KEYS.POWER:
        return this.command(record, `power ${Number(value) === 1 ? 'on' : 'off'}`, () =>
          this.setPower(record, Number(value) === 1),
        );
      case FEATURE_KEYS.FAN_SPEED:
        return this.command(record, `fan speed ${value}`, () =>
          this.setFanSpeed(record, Number(value)),
        );
      case FEATURE_KEYS.MODE:
        return this.command(record, `mode ${value}`, () => this.setMode(record, String(value)));
      case FEATURE_KEYS.BRIGHTNESS:
        return this.command(record, `display brightness ${value}`, () =>
          this.setBrightness(record, Number(value)),
        );
      case FEATURE_KEYS.CHILD_LOCK:
        return this.command(record, `child lock ${Number(value) === 1 ? 'on' : 'off'}`, () =>
          this.setChildLock(record, Number(value) === 1),
        );
      default:
        throw this.fail(ACTION_TEXT.unsupported);
    }
  }

  /**
   * Run a command, log it once, publish its effect without waiting for the
   * next reading (the cloud confirms it then).
   */
  async command(record, what, run) {
    try {
      await run();
    } catch (err) {
      if (err instanceof BlueairError) {
        logger.warn(`${record.profile.name}: ${what} failed: ${err.message}`);
        throw new Error(
          labelled(
            record.profile.name,
            pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT.http, this.language()),
            this.language(),
          ),
          { cause: err },
        );
      }
      throw err;
    }
    logger.info(`${record.profile.name}: ${what}`);
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  readingsOf(record) {
    record.readings ??= {};
    return record.readings;
  }

  async setPower(record, on) {
    const { profile } = record;
    if (!profile.features.power) {
      throw this.fail(ACTION_TEXT.unsupported);
    }
    const readings = this.readingsOf(record);
    if (profile.api === API.AWS) {
      await this.aws.setAttribute(profile.uuid, 'standby', 'vb', !on);
      readings.power = on ? 1 : 0;
      return;
    }
    // The historical cloud has no standby: off is the speed 0, on the last speed.
    const speed = on ? (record.lastSpeed ?? 1) : 0;
    await this.legacy.setAttribute(profile.uuid, 'fan_speed', speed);
    readings.power = on ? 1 : 0;
    readings.fanSpeed = speed;
  }

  async setFanSpeed(record, raw) {
    const { profile } = record;
    const range = profile.features.fanSpeed;
    if (!range || !Number.isFinite(raw)) {
      throw this.fail(ACTION_TEXT.unsupported);
    }
    const speed = Math.min(range.max, Math.max(range.min, Math.round(raw)));
    const readings = this.readingsOf(record);
    if (profile.api === API.LEGACY) {
      if (readings.mode === MODES.AUTO) {
        await this.legacy.setAttribute(profile.uuid, 'mode', 'manual');
      }
      await this.legacy.setAttribute(profile.uuid, 'fan_speed', speed);
      Object.assign(readings, { fanSpeed: speed, power: speed > 0 ? 1 : 0 });
      if (profile.features.mode) {
        readings.mode = MODES.MANUAL;
      }
      if (speed > 0) {
        record.lastSpeed = speed;
      }
      return;
    }
    // A manual speed is only honored in manual mode: leave the mode first.
    await this.leaveModeForSpeed(record);
    const written = profile.humidifier
      ? Number(Object.keys(HUMIDIFIER_SPEEDS).find((key) => HUMIDIFIER_SPEEDS[key] === speed))
      : speed;
    await this.aws.setAttribute(profile.uuid, 'fanspeed', 'v', written);
    readings.fanSpeed = speed;
    if (profile.features.mode) {
      readings.mode = MODES.MANUAL;
    }
    if (speed > 0) {
      record.lastSpeed = speed;
    }
  }

  async leaveModeForSpeed(record) {
    const { profile } = record;
    const mode = record.readings?.mode;
    if (profile.modeFamily === MODE_FAMILIES.SIGNATURE && mode !== MODES.MANUAL) {
      await this.aws.setAttribute(profile.uuid, 'apsubmode', 'v', SIGNATURE_WRITE[MODES.MANUAL]);
    } else if (profile.modeFamily === MODE_FAMILIES.COMBO && mode !== MODES.MANUAL) {
      await this.aws.setAttribute(profile.uuid, 'mode', 'v', COMBO_WRITE[MODES.MANUAL]);
    } else if (profile.modeFamily === MODE_FAMILIES.CLASSIC) {
      if (mode === MODES.AUTO) {
        await this.aws.setAttribute(profile.uuid, 'automode', 'vb', false);
      }
      if (mode === MODES.NIGHT) {
        await this.aws.setAttribute(profile.uuid, 'nightmode', 'vb', false);
        await this.sleep(this.timings.nightModeSettleMs);
      }
    }
  }

  /** Whether a device can take a mode (`profile.features.mode` lists them). */
  supportsMode(record, mode) {
    return record.profile.controllable && (record.profile.features.mode ?? []).includes(mode);
  }

  async setMode(record, mode) {
    const { profile } = record;
    if (!this.supportsMode(record, mode)) {
      throw this.fail(ACTION_TEXT.unsupported);
    }
    const readings = this.readingsOf(record);
    const current = readings.mode;
    switch (profile.modeFamily) {
      case MODE_FAMILIES.SIGNATURE:
        await this.aws.setAttribute(profile.uuid, 'apsubmode', 'v', SIGNATURE_WRITE[mode]);
        await this.aws.setAttribute(profile.uuid, 'fanspeed', 'v', SIGNATURE_SPEED_RESET);
        readings.fanSpeed = SIGNATURE_SPEED_RESET;
        break;
      case MODE_FAMILIES.COMBO:
        await this.aws.setAttribute(profile.uuid, 'mode', 'v', COMBO_WRITE[mode]);
        break;
      case MODE_FAMILIES.CLASSIC:
        if (mode === MODES.NIGHT) {
          await this.aws.setAttribute(profile.uuid, 'nightmode', 'vb', true);
        } else {
          if (current === MODES.NIGHT) {
            await this.aws.setAttribute(profile.uuid, 'nightmode', 'vb', false);
          }
          if (mode === MODES.AUTO || current === MODES.AUTO) {
            await this.aws.setAttribute(profile.uuid, 'automode', 'vb', mode === MODES.AUTO);
          }
        }
        break;
      case MODE_FAMILIES.LEGACY:
        await this.legacy.setAttribute(profile.uuid, 'mode', mode);
        break;
      default:
        throw this.fail(ACTION_TEXT.unsupported);
    }
    readings.mode = mode;
  }

  async setBrightness(record, raw) {
    const { profile } = record;
    const range = profile.features.brightness;
    if (!range || !Number.isFinite(raw)) {
      throw this.fail(ACTION_TEXT.unsupported);
    }
    const value = Math.min(range.max, Math.max(range.min, Math.round(raw)));
    if (profile.api === API.AWS) {
      await this.aws.setAttribute(profile.uuid, 'brightness', 'v', value);
    } else {
      await this.legacy.setAttribute(profile.uuid, 'brightness', value);
    }
    this.readingsOf(record).brightness = value;
  }

  async setChildLock(record, locked) {
    const { profile } = record;
    if (!profile.features.childLock) {
      throw this.fail(ACTION_TEXT.unsupported);
    }
    if (profile.api === API.AWS) {
      await this.aws.setAttribute(profile.uuid, 'childlock', 'vb', locked);
    } else {
      await this.legacy.setAttribute(profile.uuid, 'child_lock', locked ? '1' : '0');
    }
    this.readingsOf(record).childLock = locked ? 1 : 0;
  }

  /**
   * The mode of one device, or of every device that offers it (scene action,
   * widget). Resolves with the number of devices changed.
   * @param {string|null|undefined} externalId
   * @param {string} mode one of MODES
   */
  async applyMode(externalId, mode) {
    if (!Object.values(MODES).includes(mode)) {
      throw this.fail(ACTION_TEXT.unsupported);
    }
    let records;
    if (externalId) {
      const record = this.controllable(externalId);
      if (!this.supportsMode(record, mode)) {
        throw this.fail(ACTION_TEXT.unsupported);
      }
      records = [record];
    } else {
      if (this.blocked || !this.aws) {
        throw this.fail(ACTION_TEXT.notConnected);
      }
      records = [...this.records.values()].filter((record) => this.supportsMode(record, mode));
      if (records.length === 0) {
        throw this.fail(ACTION_TEXT.noDevice);
      }
    }
    const results = await Promise.allSettled(
      records.map((record) =>
        this.command(record, `mode ${mode}`, () => this.setMode(record, mode)),
      ),
    );
    const done = results.filter((result) => result.status === 'fulfilled').length;
    if (done === 0) {
      throw results[0].reason;
    }
    return done;
  }

  // --- Reports -------------------------------------------------------------------------

  /** "Test the connection": log in again, list the devices, one line each. */
  async testConnection() {
    if (!isConfigured(this.config)) {
      return CONNECTION_TEXT.notConfigured;
    }
    // An explicit test lifts a refused login: the user may have fixed the account.
    this.blocked = null;
    this.legacyRefused = false;
    this.accountError = null;
    this.pausedUntil = 0;
    await this.cycle({ discover: true });
    this.schedulePoll();
    const error = this.blocked ?? this.accountError;
    if (error) {
      return perLanguage((language) => pick(ERROR_TEXT[error.kind] ?? ERROR_TEXT.http, language));
    }
    return perLanguage((language) => {
      const text = REPORT_TEXT[language];
      const records = [...this.records.values()];
      const lines = [text.account(records.length)];
      for (const record of records) {
        const notes = [record.profile.model];
        if (!record.profile.controllable) {
          notes.push(text.readOnly);
        }
        if (record.online === false) {
          notes.push(text.offline);
        }
        lines.push(`- ${labelled(record.profile.name, notes.join(', '), language)}`);
      }
      if (this.legacyAccount) {
        lines.push(
          text.legacy(records.filter((record) => record.profile.api === API.LEGACY).length),
        );
      }
      if (records.length === 0) {
        lines.push(pick(CONNECTION_TEXT.noDevices, language));
      }
      return lines.join('\n');
    });
  }

  /** The devices the widget shows: one, or all of them. */
  view(externalId) {
    if (!externalId) {
      return [...this.records.values()];
    }
    const record = this.records.get(externalId);
    return record ? [record] : [];
  }
}
