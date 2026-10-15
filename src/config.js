// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Blueair account (the e-mail and password of the Blueair app) and the
// region it was created in. Every purifier of the account becomes a device.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Regions of the Blueair cloud (the app asks for one at sign-up).
export const REGIONS = ['eu', 'us', 'au', 'cn'];

// Refresh intervals offered in the configuration, in seconds: one to five
// minutes. The air quality readings themselves are 5-minute averages on the
// Blueair side, whatever the interval (see src/hub.js).
export const POLL_INTERVALS = ['60', '120', '180', '300'];

// Filter life left, in percent, at which the filter counts as "to replace".
export const FILTER_THRESHOLDS = ['5', '10', '15', '20'];

export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  region: 'eu',
  poll_interval: '120',
  filter_threshold: '10',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  return {
    // The Blueair account is an e-mail address: no inner space, case kept.
    username: typeof source.username === 'string' ? source.username.trim() : '',
    // Passwords are kept as typed: spaces may be part of them.
    password: typeof source.password === 'string' ? source.password : '',
    region: pick('region', REGIONS),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    filterThreshold: Number(pick('filter_threshold', FILTER_THRESHOLDS)),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Whether the account fields are filled in. */
export const isConfigured = (config) => config.username !== '' && config.password !== '';
