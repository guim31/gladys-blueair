// -----------------------------------------------------------------------------
// From the answers of the two Blueair clouds to one shape per device:
//   - a profile: what the device is and what it can do, derived from its
//     schema (current cloud) or its attributes and model (historical cloud) —
//     stable over time, it decides the Gladys features;
//   - readings: the values of the moment, null when unknown.
//
// The rules follow dahlb/blueair_api and dahlb/ha_blueair (MIT), which were
// written against real devices: see the comments for the model families.
// -----------------------------------------------------------------------------

import { modelFromSku } from './skus.js';

export const API = Object.freeze({ AWS: 'aws', LEGACY: 'legacy' });

// Values of the mode feature (text/select): permanent once published.
export const MODES = Object.freeze({
  MANUAL: 'manual',
  AUTO: 'auto',
  NIGHT: 'night',
  ECO: 'eco',
});

// How a device switches modes:
//   - classic: `automode` and `nightmode` booleans (Blue Pure Max, Protect, DustMagnet...);
//   - signature: one `apsubmode` number (Signature SP1i/SP3i/SP4i and the
//     devices of the same schema), 0 manual, 2 auto, 3 night, 4 eco
//     (ha_blueair#348, #261; 1 is read as manual too, blueair_api notes);
//   - combo: one `mode` number on the 2-in-1 purifier-humidifiers (DH3i),
//     1 manual, 2 auto, 3 night (ha_blueair#241);
//   - legacy: the `mode` attribute of the historical cloud, auto or manual.
export const MODE_FAMILIES = Object.freeze({
  CLASSIC: 'classic',
  SIGNATURE: 'signature',
  COMBO: 'combo',
  LEGACY: 'legacy',
});

const SIGNATURE_READ = {
  0: MODES.MANUAL,
  1: MODES.MANUAL,
  2: MODES.AUTO,
  3: MODES.NIGHT,
  4: MODES.ECO,
};
export const SIGNATURE_WRITE = {
  [MODES.MANUAL]: 0,
  [MODES.AUTO]: 2,
  [MODES.NIGHT]: 3,
  [MODES.ECO]: 4,
};
const COMBO_READ = { 1: MODES.MANUAL, 2: MODES.AUTO, 3: MODES.NIGHT };
export const COMBO_WRITE = { [MODES.MANUAL]: 1, [MODES.AUTO]: 2, [MODES.NIGHT]: 3 };

// Humidifiers run three speeds, stored as 11, 37 and 64 (blueair_api).
export const HUMIDIFIER_SPEEDS = { 11: 1, 37: 2, 64: 3 };

// The current cloud reports the particle densities 1.32 times higher than
// the Blueair app shows them; ha_blueair divides them (fix of 2024-12-05,
// "pm1/pm25/pm10 value discrepancy"), so does this integration.
const PM_DIVISOR = 1.32;

/** Speed bounds of a current-cloud device, from its hardware id (blueair_api fan_speed_count). */
export function awsSpeedRange(hw) {
  if (hw.startsWith('hum')) {
    return { min: 1, max: 3 };
  }
  // Four gears on a 0-91 scale (11, 37, 64, 91); the device snaps a written value to the nearest.
  if (['nb_', 'high', 's_cmb2in1', 'cmb2in1_ii'].some((prefix) => hw.startsWith(prefix))) {
    return { min: 0, max: 91 };
  }
  if (hw.startsWith('cmb3in1')) {
    return { min: 0, max: 4 };
  }
  return { min: 0, max: 100 };
}

const toNumber = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clampPercent = (value) => Math.min(100, Math.max(0, Math.round(value)));

/** The latest value of each state of a SenML-like list (`n`, `v` | `vb` | `vs`, `t`). */
export function latestStates(records) {
  const latest = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record.n !== 'string') {
      continue;
    }
    const value =
      record.v !== undefined ? record.v : record.vb !== undefined ? record.vb : record.vs;
    const time = toNumber(record.t);
    const previous = latest.get(record.n);
    if (!previous || previous.time === null || (time !== null && time >= previous.time)) {
      latest.set(record.n, { value: value ?? null, time });
    }
  }
  return latest;
}

/**
 * A device of the current cloud.
 * @param {object} info the `deviceInfo[0]` of POST /r/initial
 * @param {{ uuid: string, name?: string, mac?: string, type?: string }} listed its entry of the device list
 * @returns {{ profile: object, readings: object, sensors: object }}
 */
export function parseAwsDevice(info, listed) {
  const configuration = info?.configuration ?? {};
  const di = configuration.di ?? {};
  const ds = configuration.ds && typeof configuration.ds === 'object' ? configuration.ds : {};
  const states = latestStates(info?.states);
  // Some devices (H38i, H76i, Mini Restful) report states their control
  // schema forgets: a reported state counts as a control (blueair_api).
  const controls = new Set(Object.keys(configuration.dc ?? {}));
  for (const name of states.keys()) {
    if (name !== 'online') {
      controls.add(name);
    }
  }
  const has = (name) => controls.has(name);
  const state = (name) => (states.has(name) ? states.get(name).value : null);
  const hw = typeof di.hw === 'string' ? di.hw : '';
  const humidifier = hw.startsWith('hum');

  let modeFamily = null;
  let modes = null;
  if (has('apsubmode') && !has('automode') && !has('nightmode')) {
    modeFamily = MODE_FAMILIES.SIGNATURE;
    modes = [MODES.MANUAL, MODES.AUTO, MODES.NIGHT, MODES.ECO];
  } else if (has('mode')) {
    modeFamily = MODE_FAMILIES.COMBO;
    modes = [MODES.MANUAL, MODES.AUTO, MODES.NIGHT];
  } else if (has('automode') || has('nightmode')) {
    modeFamily = MODE_FAMILIES.CLASSIC;
    modes = [MODES.MANUAL];
    if (has('automode')) {
      modes.push(MODES.AUTO);
    }
    if (has('nightmode')) {
      modes.push(MODES.NIGHT);
    }
  }

  const vocKey = 'tVOC' in ds ? 'tVOC' : 'voc' in ds ? 'voc' : null;
  const sensorKeys = {
    pm25: 'pm2_5' in ds ? 'pm2_5' : null,
    pm10: 'pm10' in ds ? 'pm10' : null,
    voc: vocKey,
    temperature: 't' in ds ? 't' : null,
    humidity: 'h' in ds ? 'h' : null,
  };

  const model = modelFromSku(di.sku);
  const profile = {
    api: API.AWS,
    uuid: listed.uuid,
    name: nonEmpty(di.name) ?? nonEmpty(listed.name) ?? model ?? 'Blueair',
    model: model ?? (di.sku ? `Blueair (${di.sku})` : 'Blueair'),
    hardware: hw,
    firmware: nonEmpty(di.cfv),
    mac: normalizeMac(di.cma ?? listed.mac),
    // A ComfortPure 3-in-1 (T10i, T20i) heats and cools: never driven from
    // Gladys, where a wrong scene could leave a heater on (read-only device).
    controllable: !hw.startsWith('cmb3in1'),
    modeFamily,
    humidifier,
    sensorKeys,
    features: {
      power: has('standby'),
      fanSpeed: has('fanspeed') ? awsSpeedRange(hw) : null,
      mode: modes,
      brightness: has('brightness') ? { min: 0, max: 100 } : null,
      childLock: has('childlock'),
      filterLife: has('filterusage'),
      filterReplace: has('filterusage'),
      pm25: sensorKeys.pm25 !== null,
      pm10: sensorKeys.pm10 !== null,
      voc: vocKey !== null,
      co2: false,
      temperature: sensorKeys.temperature !== null,
      humidity: sensorKeys.humidity !== null,
    },
  };

  const standby = state('standby');
  let fanSpeed = toNumber(state('fanspeed'));
  if (humidifier && fanSpeed !== null) {
    fanSpeed = HUMIDIFIER_SPEEDS[fanSpeed] ?? null;
  }
  let mode = null;
  if (modeFamily === MODE_FAMILIES.SIGNATURE) {
    mode = SIGNATURE_READ[toNumber(state('apsubmode'))] ?? null;
  } else if (modeFamily === MODE_FAMILIES.COMBO) {
    mode = COMBO_READ[toNumber(state('mode'))] ?? null;
  } else if (modeFamily === MODE_FAMILIES.CLASSIC) {
    mode =
      state('nightmode') === true
        ? MODES.NIGHT
        : state('automode') === true
          ? MODES.AUTO
          : MODES.MANUAL;
  }
  const usage = toNumber(state('filterusage'));
  const childLock = state('childlock');
  const online = state('online');

  const readings = {
    power: standby === true ? 0 : standby === false ? 1 : null,
    fanSpeed,
    mode,
    brightness: toNumber(state('brightness')),
    childLock: childLock === true ? 1 : childLock === false ? 0 : null,
    filterLife: usage === null ? null : clampPercent(100 - usage),
    // Filled in from the sensor values (parseAwsSensors).
    pm25: null,
    pm10: null,
    voc: null,
    co2: null,
    temperature: null,
    humidity: null,
    // The cloud often says false while the device works (ha_blueair#287):
    // the hub also counts recent sensor values as a sign of life.
    reportedOnline: online === true ? true : online === false ? false : null,
  };

  return { profile, readings, sensors: parseSensorData(info?.sensordata) };
}

const nonEmpty = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** A MAC address as 12 lowercase hex digits, null when it is not one. */
export function normalizeMac(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length === 12 ? hex : null;
}

/**
 * The latest sensor values carried by POST /r/initial (`sensordata`): some
 * devices send them there, others only through the telemetry route.
 * @returns {{ values: Record<string, number>, time: number|null }}
 */
export function parseSensorData(records) {
  const values = {};
  let time = null;
  for (const [name, { value, time: at }] of latestStates(records)) {
    const number = toNumber(value);
    if (number !== null) {
      values[name] = number;
      time = at !== null && (time === null || at > time) ? at : time;
    }
  }
  return { values, time };
}

/**
 * The latest value of each sensor of a telemetry answer
 * (`[{ sensors: [...], datapoints: [[time, ...values]] }]`).
 * @returns {{ values: Record<string, number>, time: number|null }}
 */
export function parseTelemetry(answer) {
  const block = Array.isArray(answer) ? answer[0] : null;
  const sensors = Array.isArray(block?.sensors) ? block.sensors : [];
  const rows = (Array.isArray(block?.datapoints) ? block.datapoints : [])
    .filter((row) => Array.isArray(row) && toNumber(row[0]) !== null)
    .sort((a, b) => toNumber(a[0]) - toNumber(b[0]));
  const values = {};
  let time = null;
  // Oldest to newest: a later non-null value wins.
  for (const row of rows) {
    sensors.forEach((name, index) => {
      const number = toNumber(row[index + 1]);
      if (number !== null) {
        values[name] = number;
        time = toNumber(row[0]);
      }
    });
  }
  return { values, time };
}

/** The sensor readings of a current-cloud device, from its raw sensor values. */
export function awsSensorReadings(profile, values) {
  const read = (key) => (key === null ? null : (toNumber(values[key]) ?? null));
  const pm = (key) => {
    const value = read(key);
    return value === null ? null : Math.floor(value / PM_DIVISOR);
  };
  const { sensorKeys } = profile;
  return {
    pm25: pm(sensorKeys.pm25),
    pm10: pm(sensorKeys.pm10),
    voc: read(sensorKeys.voc),
    temperature: read(sensorKeys.temperature),
    humidity: read(sensorKeys.humidity),
  };
}

// Sensors of the historical models (ha_blueair): only the Classic i-series reports them.
const LEGACY_SENSORS = {
  classic_280i: ['pm25', 'temperature', 'humidity', 'voc', 'co2'],
  classic_290i: ['pm25', 'pm10', 'temperature', 'humidity', 'voc', 'co2'],
  classic_480i: ['pm25', 'pm10', 'temperature', 'humidity', 'voc', 'co2'],
  classic_680i: ['pm25', 'pm10', 'temperature', 'humidity', 'voc', 'co2'],
};

// Names of the data point columns of the historical cloud.
const LEGACY_COLUMNS = {
  pm: 'pm25',
  pm10: 'pm10',
  tmp: 'temperature',
  hum: 'humidity',
  co2: 'co2',
  voc: 'voc',
};

const LEGACY_MODEL_NAMES = {
  classic_205: 'Blueair Classic 205',
  classic_280i: 'Blueair Classic 280i',
  classic_290i: 'Blueair Classic 290i',
  classic_480i: 'Blueair Classic 480i',
  classic_680i: 'Blueair Classic 680i',
  'sense+': 'Blueair Sense+',
};

/**
 * A device of the historical cloud.
 * @param {object} info GET /device/<uuid>/info/
 * @param {Record<string, string>} attributes GET /device/<uuid>/attributes/
 * @param {{ uuid: string, name?: string, mac?: string }} listed
 */
export function parseLegacyDevice(info, attributes, listed) {
  const compatibility = typeof info?.compatibility === 'string' ? info.compatibility : '';
  const has = (name) => attributes[name] !== undefined && attributes[name] !== null;
  const sensors = new Set(LEGACY_SENSORS[compatibility] ?? []);
  const model = LEGACY_MODEL_NAMES[compatibility] ?? nonEmpty(info?.model) ?? 'Blueair';
  const profile = {
    api: API.LEGACY,
    uuid: listed.uuid,
    name: nonEmpty(listed.name) ?? model,
    model,
    hardware: compatibility,
    firmware: nonEmpty(info?.firmware),
    mac: normalizeMac(listed.mac),
    controllable: true,
    modeFamily: has('mode') ? MODE_FAMILIES.LEGACY : null,
    humidifier: false,
    sensorKeys: null,
    hasSensors: sensors.size > 0,
    features: {
      // The historical cloud has no standby: "off" is the fan speed 0.
      power: has('fan_speed'),
      fanSpeed: has('fan_speed') ? { min: 0, max: 3 } : null,
      mode: has('mode') ? [MODES.MANUAL, MODES.AUTO] : null,
      brightness: has('brightness') ? { min: 0, max: 4 } : null,
      childLock: has('child_lock'),
      filterLife: false,
      filterReplace: has('filter_status'),
      pm25: sensors.has('pm25'),
      pm10: sensors.has('pm10'),
      voc: sensors.has('voc'),
      co2: sensors.has('co2'),
      temperature: sensors.has('temperature'),
      humidity: sensors.has('humidity'),
    },
  };
  const fanSpeed = toNumber(attributes.fan_speed);
  const readings = {
    power: fanSpeed === null ? null : fanSpeed > 0 ? 1 : 0,
    fanSpeed,
    mode: has('mode') ? (attributes.mode === 'auto' ? MODES.AUTO : MODES.MANUAL) : null,
    brightness: toNumber(attributes.brightness),
    childLock: has('child_lock') ? (String(attributes.child_lock) === '1' ? 1 : 0) : null,
    filterLife: null,
    filterExpired: has('filter_status') ? attributes.filter_status !== 'OK' : null,
    pm25: null,
    pm10: null,
    voc: null,
    co2: null,
    temperature: null,
    humidity: null,
    reportedOnline: has('wifi_status') ? String(attributes.wifi_status) === '1' : null,
  };
  return { profile, readings };
}

/** The sensor readings of a historical device, from its latest data point. */
export function legacySensorReadings(profile, dataPoint) {
  const sensors = Array.isArray(dataPoint?.sensors) ? dataPoint.sensors : [];
  const rows = Array.isArray(dataPoint?.datapoints) ? dataPoint.datapoints : [];
  const row = rows[rows.length - 1];
  const readings = {};
  const columns = {};
  if (Array.isArray(row)) {
    sensors.forEach((name, index) => {
      if (LEGACY_COLUMNS[name]) {
        columns[LEGACY_COLUMNS[name]] = toNumber(row[index]);
      }
    });
  }
  for (const key of ['pm25', 'pm10', 'voc', 'co2', 'temperature', 'humidity']) {
    readings[key] = profile.features[key] ? (columns[key] ?? null) : null;
  }
  const timeIndex = sensors.indexOf('time');
  return { readings, time: Array.isArray(row) && timeIndex >= 0 ? toNumber(row[timeIndex]) : null };
}
