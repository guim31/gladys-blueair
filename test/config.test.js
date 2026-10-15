// -----------------------------------------------------------------------------
// Normalization of the configuration: strings from the form, blanks, values
// outside the lists — the rest of the code only sees clean values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig } from '../src/config.js';

test('defaults when nothing is configured', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, {
    username: '',
    password: '',
    region: 'eu',
    pollIntervalMs: 120_000,
    filterThreshold: 10,
    language: 'fr',
  });
  assert.equal(isConfigured(config), false);
  assert.deepEqual(normalizeConfig(null), config);
});

test('values from the form', () => {
  const config = normalizeConfig({
    username: '  someone@example.com ',
    password: ' spaces kept ',
    region: 'us',
    poll_interval: '300',
    filter_threshold: '20',
    language: 'de',
  });
  assert.deepEqual(config, {
    username: 'someone@example.com',
    password: ' spaces kept ',
    region: 'us',
    pollIntervalMs: 300_000,
    filterThreshold: 20,
    language: 'de',
  });
  assert.equal(isConfigured(config), true);
});

test('values outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({
    username: 42,
    password: null,
    region: 'mars',
    poll_interval: 7,
    filter_threshold: '3',
    language: 'it',
  });
  assert.equal(config.username, '');
  assert.equal(config.password, '');
  assert.equal(config.region, DEFAULT_CONFIG.region);
  assert.equal(config.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(config.filterThreshold, Number(DEFAULT_CONFIG.filter_threshold));
  assert.equal(config.language, 'fr');
  // A number from an older form is accepted when it is in the list.
  assert.equal(normalizeConfig({ poll_interval: 60 }).pollIntervalMs, 60_000);
});
