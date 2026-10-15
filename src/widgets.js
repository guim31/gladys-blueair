// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `purifier`.
//
// The use cases: "how is the air, and are my filters fine?" at a glance, and
// "night mode in every room" in one tap at bedtime, from the wall tablet.
//
// Two layouts, by the `device` setting:
//   - every device (no device chosen): one status row per device (PM2.5 or
//     its state, colored by the air quality, the filter flagged), and two
//     buttons, "All in auto" and "All in night mode";
//   - one device: live tiles bound to its features (PM2.5, filter life,
//     temperature or VOC), a status list (mode, filter, connection), and up
//     to four buttons — the power switch (a device feature button) and the
//     modes it offers. The current mode is marked by its icon, never by the
//     style (`primary` is invisible in dark mode, Gladys#3153).
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): at most 3 tiles, one
// status list and 4 buttons. A heating device (ComfortPure 3-in-1) is shown
// without buttons: Gladys only reads it.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MODES } from './blueair/model.js';
import { FEATURE_KEYS, MODE_LABELS, deviceIds, filterToReplace } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, perLanguage, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  ALL_AUTO: 'all_auto',
  ALL_NIGHT: 'all_night',
  MODE_AUTO: 'mode_auto',
  MODE_NIGHT: 'mode_night',
  MODE_ECO: 'mode_eco',
});

const MODE_ACTIONS = [
  [ACTIONS.MODE_AUTO, MODES.AUTO, 'refresh-cw'],
  [ACTIONS.MODE_NIGHT, MODES.NIGHT, 'moon'],
  [ACTIONS.MODE_ECO, MODES.ECO, 'feather'],
];

const ACTIVE_ICON = 'check-circle';

// PM2.5 bands, µg/m³ (24-hour guideline of the WHO 2021 and its interim targets).
const PM25_GOOD = 15;
const PM25_FAIR = 35;

export const TEXT = {
  notConfigured: {
    en: 'Enter your Blueair account in the configuration of the integration.',
    fr: 'Saisissez votre compte Blueair dans la configuration de l’intégration.',
    de: 'Gib dein Blueair-Konto in der Konfiguration der Integration ein.',
    es: 'Introduzca su cuenta Blueair en la configuración de la integración.',
  },
  noDevice: {
    en: 'No Blueair device on the account yet.',
    fr: 'Aucun appareil Blueair sur le compte pour l’instant.',
    de: 'Noch kein Blueair-Gerät im Konto.',
    es: 'Todavía no hay ningún dispositivo Blueair en la cuenta.',
  },
  unknown: {
    en: 'This device is no longer on the Blueair account: choose another one in the widget settings.',
    fr: 'Cet appareil n’est plus sur le compte Blueair : choisissez-en un autre dans les réglages du widget.',
    de: 'Dieses Gerät ist nicht mehr im Blueair-Konto: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este dispositivo ya no está en la cuenta Blueair: elija otro en la configuración del widget.',
  },
  pm25: { en: 'PM2.5', fr: 'PM2.5', de: 'PM2.5', es: 'PM2.5' },
  filter: { en: 'Filter', fr: 'Filtre', de: 'Filter', es: 'Filtro' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  voc: { en: 'VOC', fr: 'COV', de: 'VOC', es: 'COV' },
  mode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  connection: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'Conectado' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Desconectado' },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  filterOk: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  filterReplace: { en: 'To replace', fr: 'À changer', de: 'Wechseln', es: 'Por cambiar' },
  filterToReplace: {
    en: 'Filter to replace',
    fr: 'Filtre à changer',
    de: 'Filter wechseln',
    es: 'Filtro por cambiar',
  },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  allAuto: { en: 'All in auto', fr: 'Tout en auto', de: 'Alle auf Auto', es: 'Todo en auto' },
  allNight: { en: 'All in night', fr: 'Tout en nuit', de: 'Alle auf Nacht', es: 'Todo en noche' },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: (mode, count) => `${MODE_LABELS.en[mode]} mode on ${count} device(s).`,
  fr: (mode, count) => `Mode ${MODE_LABELS.fr[mode].toLowerCase()} sur ${count} appareil(s).`,
  de: (mode, count) => `Modus ${MODE_LABELS.de[mode]} auf ${count} Gerät(en).`,
  es: (mode, count) => `Modo ${MODE_LABELS.es[mode].toLowerCase()} en ${count} dispositivo(s).`,
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const pmColor = (pm25) =>
  pm25 <= PM25_GOOD
    ? WIDGET_COLORS.SUCCESS
    : pm25 <= PM25_FAIR
      ? WIDGET_COLORS.WARNING
      : WIDGET_COLORS.DANGER;

/** The status row of one device in the overview. */
function overviewRow(record, hub, language) {
  const label = fit(record.profile.name, 40);
  const readings = record.readings ?? {};
  if (record.reachable === false || record.online === false) {
    return {
      label,
      icon: 'wifi-off',
      value: t(TEXT.offline, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (!record.readings) {
    return { label, icon: 'clock', value: t(TEXT.waiting, language), color: WIDGET_COLORS.NEUTRAL };
  }
  const parts = [];
  let color = WIDGET_COLORS.NEUTRAL;
  const replace = filterToReplace(readings, hub.config.filterThreshold);
  // The filter to replace comes first: it is what needs doing.
  if (replace) {
    parts.push(t(TEXT.filterToReplace, language));
  } else if (readings.power === 0) {
    parts.push(t(TEXT.off, language));
  } else if (readings.mode) {
    parts.push((MODE_LABELS[language] ?? MODE_LABELS.en)[readings.mode]);
  }
  if (readings.pm25 !== null && readings.pm25 !== undefined) {
    parts.push(`PM2.5 ${readings.pm25} µg/m³`);
    color = pmColor(readings.pm25);
  }
  if (replace && color !== WIDGET_COLORS.DANGER) {
    color = WIDGET_COLORS.WARNING;
  }
  return {
    label,
    icon: 'wind',
    value: fit(parts.join(' · ') || t(TEXT.waiting, language), 40),
    color,
  };
}

function overview(hub, records, language) {
  const components = [
    { type: 'status', items: records.slice(0, 10).map((r) => overviewRow(r, hub, language)) },
  ];
  const offers = (mode) => records.some((record) => hub.supportsMode(record, mode));
  const allIn = (mode) =>
    records
      .filter((record) => hub.supportsMode(record, mode))
      .every((r) => r.readings?.mode === mode);
  if (offers(MODES.AUTO)) {
    components.push({
      type: 'button',
      label: t(TEXT.allAuto, language),
      icon: allIn(MODES.AUTO) ? ACTIVE_ICON : 'refresh-cw',
      style: 'secondary',
      action: { key: ACTIONS.ALL_AUTO },
    });
  }
  if (offers(MODES.NIGHT)) {
    components.push({
      type: 'button',
      label: t(TEXT.allNight, language),
      icon: allIn(MODES.NIGHT) ? ACTIVE_ICON : 'moon',
      style: 'secondary',
      action: { key: ACTIONS.ALL_NIGHT },
    });
  }
  return { ttl_seconds: 120, components };
}

function detail(hub, record, language) {
  const { profile } = record;
  const readings = record.readings ?? {};
  const ids = deviceIds(hub.gladys, profile.uuid);
  const components = [];

  // Live tiles: they follow the published states, no TTL involved.
  if (profile.features.pm25) {
    components.push({
      type: 'value',
      label: t(TEXT.pm25, language),
      icon: 'wind',
      device_feature: ids.feature(FEATURE_KEYS.PM25),
    });
  }
  if (profile.features.filterLife) {
    components.push({
      type: 'gauge',
      label: t(TEXT.filter, language),
      min: 0,
      max: 100,
      device_feature: ids.feature(FEATURE_KEYS.FILTER_LIFE),
    });
  }
  if (profile.features.temperature) {
    components.push({
      type: 'value',
      label: t(TEXT.temperature, language),
      icon: 'thermometer',
      device_feature: ids.feature(FEATURE_KEYS.TEMPERATURE),
    });
  } else if (profile.features.voc) {
    components.push({
      type: 'value',
      label: t(TEXT.voc, language),
      icon: 'cloud',
      device_feature: ids.feature(FEATURE_KEYS.VOC),
    });
  }

  const items = [];
  if (profile.features.mode && readings.mode) {
    items.push({
      label: t(TEXT.mode, language),
      icon: 'sliders',
      value:
        readings.power === 0
          ? t(TEXT.off, language)
          : (MODE_LABELS[language] ?? MODE_LABELS.en)[readings.mode],
      color: readings.power === 0 ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.INFO,
    });
  }
  const replace = filterToReplace(readings, hub.config.filterThreshold);
  if (replace !== null) {
    items.push({
      label: t(TEXT.filter, language),
      icon: 'filter',
      value: t(replace ? TEXT.filterReplace : TEXT.filterOk, language),
      color: replace ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }
  const online = record.reachable !== false && record.online !== false;
  items.push({
    label: t(TEXT.connection, language),
    icon: online ? 'wifi' : 'wifi-off',
    value: t(online ? TEXT.online : TEXT.offline, language),
    color: online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  });
  components.push({ type: 'status', items });

  if (profile.controllable) {
    if (profile.features.power) {
      const on = readings.power !== 0;
      components.push({
        type: 'button',
        label: t(on ? TEXT.turnOff : TEXT.turnOn, language),
        icon: 'power',
        style: 'secondary',
        device_feature: ids.feature(FEATURE_KEYS.POWER),
        value: on ? 0 : 1,
      });
    }
    for (const [key, mode, icon] of MODE_ACTIONS) {
      if (hub.supportsMode(record, mode)) {
        components.push({
          type: 'button',
          label: (MODE_LABELS[language] ?? MODE_LABELS.en)[mode],
          icon: readings.mode === mode && readings.power !== 0 ? ACTIVE_ICON : icon,
          style: 'secondary',
          action: { key, params: { device: record.externalId } },
        });
      }
    }
  }
  return { ttl_seconds: 120, components: components.slice(0, 8) };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.config || hub.config.username === '' || hub.config.password === '') {
    return message(TEXT.notConfigured, language);
  }
  const error = hub.blocked ?? hub.accountError;
  if (hub.records.size === 0) {
    return error
      ? message(ERROR_TEXT[error.kind] ?? ERROR_TEXT.http, language)
      : message(TEXT.noDevice, language);
  }
  const records = hub.view(settings?.device);
  if (records.length === 0) {
    return message(TEXT.unknown, language);
  }
  return settings?.device ? detail(hub, records[0], language) : overview(hub, records, language);
}

async function action(hub, { actionKey, params = {} }) {
  const modes = {
    [ACTIONS.ALL_AUTO]: [MODES.AUTO, null],
    [ACTIONS.ALL_NIGHT]: [MODES.NIGHT, null],
    [ACTIONS.MODE_AUTO]: [MODES.AUTO, params.device],
    [ACTIONS.MODE_NIGHT]: [MODES.NIGHT, params.device],
    [ACTIONS.MODE_ECO]: [MODES.ECO, params.device],
  };
  if (!modes[actionKey]) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const [mode, device] = modes[actionKey];
  // A device action without its device would change every device: refused.
  if (device === undefined || device === '') {
    throw new Error(`Action ${actionKey} without its device`);
  }
  const count = await hub.applyMode(device, mode);
  return { message: perLanguage((language) => DONE_TEXT[language](mode, count)) };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
