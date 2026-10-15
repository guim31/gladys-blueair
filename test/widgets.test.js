// -----------------------------------------------------------------------------
// The `purifier` dashboard widget: every content passes the SDK validator and
// the core budget, every live tile points at a feature the device really
// publishes (validateWidgetContent cannot know), the buttons do what they say.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIONS } from '../src/widgets.js';
import { legacyClassic480i } from './helpers/fakeBlueair.js';
import { CONFIG, createAll, createWorld, deviceId, discovered } from './helpers/world.js';

const KEY = 'purifier';
const LANGUAGES = ['en', 'fr', 'de', 'es'];

async function world(t, options = {}) {
  const w = await createWorld({
    devices: ['protect7470i', 'sp4i', 't10i', 'max211i'],
    legacyDevices: [legacyClassic480i()],
    ...options,
  });
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(KEY, { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

/** The core budget (dashboard-widgets.md §5) and the SDK validator. */
function assertValid(widget, where) {
  assert.deepEqual(validateWidgetContent(widget), [], where);
  const count = (types) => widget.components.filter((c) => types.includes(c.type)).length;
  assert.ok(widget.components.length <= 8, `${where}: 8 components at most`);
  assert.ok(count(['text']) <= 2, `${where}: 2 texts at most`);
  assert.ok(count(['value', 'gauge']) <= 6, `${where}: 6 tiles at most`);
  assert.ok(count(['status']) <= 1, `${where}: one status list`);
  assert.ok(count(['button']) <= 4, `${where}: 4 buttons at most`);
  const actionKeys = widget.components.filter((c) => c.action).map((c) => c.action.key);
  assert.equal(new Set(actionKeys).size, actionKeys.length, `${where}: unique action keys`);
  for (const item of widget.components.find((c) => c.type === 'status')?.items ?? []) {
    assert.ok(
      item.value !== undefined && String(item.value).length <= 40,
      `${where}: status value`,
    );
    assert.ok(item.label.length <= 40, `${where}: status label`);
  }
}

test('overview: one row per device, two buttons, valid in every language', async (t) => {
  const w = await world(t);
  for (const language of LANGUAGES) {
    const widget = await content(w, {}, language);
    assertValid(widget, `overview ${language}`);
    const status = widget.components.find((c) => c.type === 'status');
    assert.equal(status.items.length, 5);
    assert.deepEqual(
      widget.components.filter((c) => c.type === 'button').map((c) => c.action.key),
      [ACTIONS.ALL_AUTO, ACTIONS.ALL_NIGHT],
    );
  }
  const status = (await content(w)).components.find((c) => c.type === 'status');
  const office = status.items.find((item) => item.label === 'Office');
  assert.equal(office.value, 'Manual · PM2.5 0 µg/m³');
  assert.equal(office.color, 'success');
});

test('overview: a filter to replace and an offline device stand out', async (t) => {
  const w = await world(t);
  w.cloud.setState('protect7470i', 'filterusage', 95);
  w.cloud.setState('max211i', 'online', false);
  // Old sensor values only: nothing says the 211i is alive.
  await w.hub.cycle();
  const status = (await content(w, {}, 'fr')).components.find((c) => c.type === 'status');
  const office = status.items.find((item) => item.label === 'Office');
  assert.equal(office.value, 'Filtre à changer · PM2.5 0 µg/m³');
  assert.equal(office.color, 'warning');
  const bedroom = status.items.find((item) => item.label === 'Bedroom');
  assert.equal(bedroom.value, 'Hors ligne');
  assert.equal(bedroom.color, 'danger');
});

test('one device: live tiles on its own features, its modes, the power button', async (t) => {
  const w = await world(t);
  await createAll(w);
  for (const key of ['protect7470i', 'sp4i', 't10i', 'max211i']) {
    const uuid = w.cloud.uuid(key);
    const device = discovered(w, uuid);
    const published = new Set(device.features.map((f) => f.external_id));
    for (const language of LANGUAGES) {
      const widget = await content(w, { device: device.external_id }, language);
      assertValid(widget, `${key} ${language}`);
      for (const component of widget.components) {
        if (component.device_feature) {
          assert.ok(published.has(component.device_feature), `${key}: ${component.device_feature}`);
        }
      }
    }
  }
  const sp4i = await content(w, { device: deviceId(w, w.cloud.uuid('sp4i')) });
  const buttons = sp4i.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.label),
    ['Turn off', 'Auto', 'Night', 'Eco'],
  );
  assert.equal(buttons[0].value, 0);
  assert.equal(buttons[1].icon, 'check-circle', 'the current mode is marked by its icon');
  assert.ok(
    buttons.every((b) => b.style === 'secondary'),
    'never primary (dark mode)',
  );

  const t10i = await content(w, { device: deviceId(w, w.cloud.uuid('t10i')) });
  assert.equal(t10i.components.filter((c) => c.type === 'button').length, 0, 'read only');
});

test('the mode buttons change the mode; "all" buttons every device that offers it', async (t) => {
  const w = await world(t);
  const night = await w.fake.widgetAction(KEY, ACTIONS.ALL_NIGHT, {}, { settings: {} });
  assert.equal(night.success, true, night.error);
  assert.equal(night.data.message.en, 'Night mode on 3 device(s).');
  assert.equal(night.data.message.fr, 'Mode nuit sur 3 appareil(s).');

  const sp4i = deviceId(w, w.cloud.uuid('sp4i'));
  const eco = await w.fake.widgetAction(KEY, ACTIONS.MODE_ECO, { device: sp4i }, { settings: {} });
  assert.equal(eco.success, true);
  assert.equal(w.cloud.commands.at(-2).name, 'apsubmode');

  const orphan = await w.fake.widgetAction(KEY, ACTIONS.MODE_AUTO, {}, { settings: {} });
  assert.equal(orphan.success, false, 'a device button never falls back to every device');
  const unknown = await w.fake.widgetAction(KEY, 'dance', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('messages: not configured, no device, unknown device, account error', async (t) => {
  const empty = await world(t, { config: {} });
  assertValid(await content(empty), 'not configured');
  assert.match((await content(empty, {}, 'de')).components[0].text, /Blueair-Konto/);

  const none = await world(t, { devices: [], legacyDevices: [] });
  assert.match((await content(none)).components[0].text, /No Blueair device/);

  const w = await world(t);
  const gone = await content(w, { device: 'ext:test-integration:blueair:gone' });
  assertValid(gone, 'unknown device');
  assert.match(gone.components[0].text, /no longer/);

  const wrong = await world(t, { config: { ...CONFIG, password: 'nope' } });
  assert.match((await content(wrong, {}, 'es')).components[0].text, /rechazados/);
});
