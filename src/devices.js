// -----------------------------------------------------------------------------
// One Gladys device per Blueair device of the account.
//
// Identity: the device id the Blueair cloud gives (a UUID on the current
// cloud, a hexadecimal id on the historical one) — never its name, which the
// user can change in the app.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js), each one only when the device has it:
//   - power: switch/binary — standby on the current cloud, the fan speed 0 on
//     the historical one;
//   - fan speed: fan/speed, with the bounds of the model (0-100, 0-91 on the
//     four-gear models, 1-3 on humidifiers, 0-3 on the historical models);
//   - mode: text/select — manual, auto, night, eco (Signature only);
//   - display brightness: light/brightness (0-100, 0-4 historical);
//   - child lock: child-lock/binary;
//   - filter life: hepa-filter-monitoring/filter-life-remaining (%);
//   - filter to replace: input/binary, 1 at the threshold of the
//     configuration (the only filter information of the historical cloud);
//   - PM2.5, PM10 (µg/m³), VOC (ppb), CO2 (ppm), temperature, humidity;
//   - online: input/binary.
// PM1 is not published: Gladys has no PM1 sensor category.
//
// A device that is not `controllable` (a ComfortPure 3-in-1, which heats) has
// every feature read-only.
//
// The devices are published with should_poll: false: the integration reads
// the cloud on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { MODES } from './blueair/model.js';

export const DEVICE_TYPE = 'blueair';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  POWER: 'power',
  FAN_SPEED: 'fan_speed',
  MODE: 'mode',
  BRIGHTNESS: 'brightness',
  CHILD_LOCK: 'child_lock',
  FILTER_LIFE: 'filter_life',
  FILTER_REPLACE: 'filter_replace',
  PM25: 'pm25',
  PM10: 'pm10',
  VOC: 'voc',
  CO2: 'co2',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  ONLINE: 'online',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.POWER]: 'Power',
    [FEATURE_KEYS.FAN_SPEED]: 'Fan speed',
    [FEATURE_KEYS.MODE]: 'Mode',
    [FEATURE_KEYS.BRIGHTNESS]: 'Display brightness',
    [FEATURE_KEYS.CHILD_LOCK]: 'Child lock',
    [FEATURE_KEYS.FILTER_LIFE]: 'Filter life',
    [FEATURE_KEYS.FILTER_REPLACE]: 'Filter to replace',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.PM10]: 'PM10',
    [FEATURE_KEYS.VOC]: 'VOC',
    [FEATURE_KEYS.CO2]: 'CO2',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperature',
    [FEATURE_KEYS.HUMIDITY]: 'Humidity',
    [FEATURE_KEYS.ONLINE]: 'Online',
  },
  fr: {
    [FEATURE_KEYS.POWER]: 'Marche',
    [FEATURE_KEYS.FAN_SPEED]: 'Vitesse du ventilateur',
    [FEATURE_KEYS.MODE]: 'Mode',
    [FEATURE_KEYS.BRIGHTNESS]: "Luminosité de l'affichage",
    [FEATURE_KEYS.CHILD_LOCK]: 'Sécurité enfant',
    [FEATURE_KEYS.FILTER_LIFE]: 'Durée de vie du filtre',
    [FEATURE_KEYS.FILTER_REPLACE]: 'Filtre à changer',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.PM10]: 'PM10',
    [FEATURE_KEYS.VOC]: 'COV',
    [FEATURE_KEYS.CO2]: 'CO2',
    [FEATURE_KEYS.TEMPERATURE]: 'Température',
    [FEATURE_KEYS.HUMIDITY]: 'Humidité',
    [FEATURE_KEYS.ONLINE]: 'En ligne',
  },
  de: {
    [FEATURE_KEYS.POWER]: 'Betrieb',
    [FEATURE_KEYS.FAN_SPEED]: 'Lüfterstufe',
    [FEATURE_KEYS.MODE]: 'Modus',
    [FEATURE_KEYS.BRIGHTNESS]: 'Displayhelligkeit',
    [FEATURE_KEYS.CHILD_LOCK]: 'Kindersicherung',
    [FEATURE_KEYS.FILTER_LIFE]: 'Filterlebensdauer',
    [FEATURE_KEYS.FILTER_REPLACE]: 'Filter wechseln',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.PM10]: 'PM10',
    [FEATURE_KEYS.VOC]: 'VOC',
    [FEATURE_KEYS.CO2]: 'CO2',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatur',
    [FEATURE_KEYS.HUMIDITY]: 'Luftfeuchtigkeit',
    [FEATURE_KEYS.ONLINE]: 'Online',
  },
  es: {
    [FEATURE_KEYS.POWER]: 'Encendido',
    [FEATURE_KEYS.FAN_SPEED]: 'Velocidad del ventilador',
    [FEATURE_KEYS.MODE]: 'Modo',
    [FEATURE_KEYS.BRIGHTNESS]: 'Brillo de la pantalla',
    [FEATURE_KEYS.CHILD_LOCK]: 'Bloqueo infantil',
    [FEATURE_KEYS.FILTER_LIFE]: 'Vida útil del filtro',
    [FEATURE_KEYS.FILTER_REPLACE]: 'Filtro por cambiar',
    [FEATURE_KEYS.PM25]: 'PM2.5',
    [FEATURE_KEYS.PM10]: 'PM10',
    [FEATURE_KEYS.VOC]: 'COV',
    [FEATURE_KEYS.CO2]: 'CO2',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatura',
    [FEATURE_KEYS.HUMIDITY]: 'Humedad',
    [FEATURE_KEYS.ONLINE]: 'Conectado',
  },
};

// Labels of the mode options (supported_options labels are plain strings:
// they follow the configured language, refreshed at each publication).
export const MODE_LABELS = {
  en: { manual: 'Manual', auto: 'Auto', night: 'Night', eco: 'Eco' },
  fr: { manual: 'Manuel', auto: 'Auto', night: 'Nuit', eco: 'Éco' },
  de: { manual: 'Manuell', auto: 'Automatisch', night: 'Nacht', eco: 'Eco' },
  es: { manual: 'Manual', auto: 'Automático', night: 'Noche', eco: 'Eco' },
};

// Display bounds of the sensors (the core never applies them on write).
const PM_MAX = 1000;
const VOC_MAX = 10_000;
const CO2_MAX = 5000;

const sensor = (category, type, unit, min, max) => ({
  category,
  type,
  unit,
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

const binarySensor = (category, type) => ({
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

/**
 * Order = display order in Gladys. `definition(profile)` gives the feature
 * fields, `value(readings, context)` the state to publish (null: nothing).
 * A text feature's value is published as `{ text }`.
 */
const FEATURES = [
  {
    key: FEATURE_KEYS.POWER,
    present: (profile) => profile.features.power,
    definition: (profile) => ({
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: !profile.controllable,
      has_feedback: true,
      keep_history: true,
    }),
    value: (readings) => readings.power,
  },
  {
    key: FEATURE_KEYS.FAN_SPEED,
    present: (profile) => profile.features.fanSpeed !== null,
    definition: (profile) => ({
      category: DEVICE_FEATURE_CATEGORIES.FAN,
      type: DEVICE_FEATURE_TYPES.FAN.SPEED,
      min: profile.features.fanSpeed.min,
      max: profile.features.fanSpeed.max,
      read_only: !profile.controllable,
      has_feedback: true,
      keep_history: true,
    }),
    value: (readings) => readings.fanSpeed,
  },
  {
    key: FEATURE_KEYS.MODE,
    present: (profile) => profile.features.mode !== null,
    definition: (profile, language) => ({
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
      // NOT NULL in the core, even for a text feature.
      min: 0,
      max: 0,
      read_only: !profile.controllable,
      has_feedback: true,
      keep_history: true,
      supported_options: profile.features.mode.map((mode, index) => ({
        value: mode,
        label: (MODE_LABELS[language] ?? MODE_LABELS.en)[mode],
        sort_order: index,
      })),
    }),
    value: (readings) => (readings.mode ? { text: readings.mode } : null),
  },
  {
    key: FEATURE_KEYS.BRIGHTNESS,
    present: (profile) => profile.features.brightness !== null,
    definition: (profile) => ({
      category: DEVICE_FEATURE_CATEGORIES.LIGHT,
      type: DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS,
      min: profile.features.brightness.min,
      max: profile.features.brightness.max,
      read_only: !profile.controllable,
      has_feedback: true,
      keep_history: false,
    }),
    value: (readings) => readings.brightness,
  },
  {
    key: FEATURE_KEYS.CHILD_LOCK,
    present: (profile) => profile.features.childLock,
    definition: (profile) => ({
      category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
      type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
      min: 0,
      max: 1,
      read_only: !profile.controllable,
      has_feedback: true,
      keep_history: false,
    }),
    value: (readings) => readings.childLock,
  },
  {
    key: FEATURE_KEYS.FILTER_LIFE,
    present: (profile) => profile.features.filterLife,
    definition: () =>
      sensor(
        DEVICE_FEATURE_CATEGORIES.HEPA_FILTER_MONITORING,
        DEVICE_FEATURE_TYPES.FILTER_MONITORING.FILTER_LIFE_REMAINING,
        DEVICE_FEATURE_UNITS.PERCENT,
        0,
        100,
      ),
    value: (readings) => readings.filterLife,
  },
  {
    key: FEATURE_KEYS.FILTER_REPLACE,
    present: (profile) => profile.features.filterReplace,
    definition: () =>
      binarySensor(DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.INPUT.BINARY),
    value: (readings, { filterThreshold }) => {
      const replace = filterToReplace(readings, filterThreshold);
      return replace === null ? null : replace ? 1 : 0;
    },
  },
  {
    key: FEATURE_KEYS.PM25,
    present: (profile) => profile.features.pm25,
    definition: () =>
      sensor(
        DEVICE_FEATURE_CATEGORIES.PM25_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
        0,
        PM_MAX,
      ),
    value: (readings) => readings.pm25,
  },
  {
    key: FEATURE_KEYS.PM10,
    present: (profile) => profile.features.pm10,
    definition: () =>
      sensor(
        DEVICE_FEATURE_CATEGORIES.PM10_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
        0,
        PM_MAX,
      ),
    value: (readings) => readings.pm10,
  },
  {
    key: FEATURE_KEYS.VOC,
    present: (profile) => profile.features.voc,
    definition: () =>
      sensor(
        DEVICE_FEATURE_CATEGORIES.VOC_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        DEVICE_FEATURE_UNITS.PPB,
        0,
        VOC_MAX,
      ),
    value: (readings) => readings.voc,
  },
  {
    key: FEATURE_KEYS.CO2,
    present: (profile) => profile.features.co2,
    definition: () =>
      sensor(
        DEVICE_FEATURE_CATEGORIES.CO2_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        DEVICE_FEATURE_UNITS.PPM,
        0,
        CO2_MAX,
      ),
    value: (readings) => (readings.co2 === null ? null : Math.round(readings.co2)),
  },
  {
    key: FEATURE_KEYS.TEMPERATURE,
    present: (profile) => profile.features.temperature,
    definition: () =>
      sensor(
        DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        DEVICE_FEATURE_UNITS.CELSIUS,
        -20,
        60,
      ),
    value: (readings) => readings.temperature,
  },
  {
    key: FEATURE_KEYS.HUMIDITY,
    present: (profile) => profile.features.humidity,
    definition: () =>
      sensor(
        DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        DEVICE_FEATURE_UNITS.PERCENT,
        0,
        100,
      ),
    value: (readings) => readings.humidity,
  },
  {
    key: FEATURE_KEYS.ONLINE,
    present: () => true,
    definition: () =>
      binarySensor(DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.INPUT.BINARY),
    value: (readings) => (readings.online === null ? null : readings.online ? 1 : 0),
  },
];

/**
 * Whether the filter is to replace: the historical cloud says so itself, the
 * current one gives the life left, compared with the configured threshold.
 * @returns {boolean|null}
 */
export function filterToReplace(readings, threshold) {
  if (readings.filterLife !== null && readings.filterLife !== undefined) {
    return readings.filterLife <= threshold;
  }
  if (readings.filterExpired !== null && readings.filterExpired !== undefined) {
    return readings.filterExpired;
  }
  return null;
}

/** External ids of a Blueair device and its features. */
export const deviceIds = (gladys, uuid) => gladys.externalIds(DEVICE_TYPE, uuid);

/** The feature key of a feature external id of a device, null when it is not one. */
export function featureKeyOf(gladys, uuid, featureExternalId) {
  const ids = deviceIds(gladys, uuid);
  return Object.values(FEATURE_KEYS).find((key) => ids.feature(key) === featureExternalId) ?? null;
}

// Device params: shown in Gladys, never a secret nor an address.
export const PARAMS = Object.freeze({
  MODEL: 'BLUEAIR_MODEL',
  CLOUD: 'BLUEAIR_CLOUD',
  FIRMWARE: 'BLUEAIR_FIRMWARE',
});

/**
 * The discovery payload of a device.
 * @param {object} gladys SDK client
 * @param {object} profile see src/blueair/model.js
 * @param {string} language feature names language
 */
export function buildDevice(gladys, profile, language = 'en') {
  const ids = deviceIds(gladys, profile.uuid);
  const names = NAMES[language] ?? NAMES.en;
  const params = [
    { name: PARAMS.MODEL, value: profile.model },
    { name: PARAMS.CLOUD, value: profile.api },
  ];
  if (profile.firmware) {
    params.push({ name: PARAMS.FIRMWARE, value: profile.firmware });
  }
  return {
    name: profile.name,
    external_id: ids.device,
    should_poll: false,
    params,
    features: FEATURES.filter((feature) => feature.present(profile)).map((feature) => ({
      ...feature.definition(profile, language),
      name: names[feature.key],
      external_id: ids.feature(feature.key),
    })),
  };
}

/**
 * The states of a device for its readings, in the publishStates format
 * (unknown values left out).
 * @param {object} gladys
 * @param {object} profile
 * @param {object} readings
 * @param {{ filterThreshold: number }} context
 */
export function deviceStates(gladys, profile, readings, context) {
  const ids = deviceIds(gladys, profile.uuid);
  const states = [];
  for (const feature of FEATURES) {
    if (!feature.present(profile)) {
      continue;
    }
    const value = feature.value(readings, context);
    if (value === null || value === undefined) {
      continue;
    }
    const externalId = ids.feature(feature.key);
    states.push(
      typeof value === 'object'
        ? { device_feature_external_id: externalId, text: value.text }
        : { device_feature_external_id: externalId, state: value },
    );
  }
  return states;
}

export { MODES };
