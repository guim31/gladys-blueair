// -----------------------------------------------------------------------------
// From the real answers of the Blueair cloud to profiles and readings: the
// model families (classic, Signature, 2-in-1, humidifier, heater), the speed
// bounds, the filter, the sensors and their correction.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODES,
  MODE_FAMILIES,
  awsSensorReadings,
  awsSpeedRange,
  latestStates,
  legacySensorReadings,
  normalizeMac,
  parseAwsDevice,
  parseLegacyDevice,
  parseSensorData,
  parseTelemetry,
} from '../src/blueair/model.js';
import { modelFromSku } from '../src/blueair/skus.js';
import { legacyClassic480i } from './helpers/fakeBlueair.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/blueair/aws/${name}`, import.meta.url), 'utf8'));
const parse = (name, listed = {}) => {
  const info = fixture(name);
  return parseAwsDevice(info, { uuid: info.id, name: 'Listed name', ...listed });
};

test('Blue Pure 211i Max: classic modes, four gears, filter, PM from the state answer', () => {
  const { profile, readings, sensors } = parse('blue-pure-211i-max.json');
  assert.equal(profile.model, 'Blueair Blue Pure 211i Max');
  assert.equal(profile.name, 'Bedroom', 'the name of the app wins over the listed one');
  assert.equal(profile.firmware, '1.1.6');
  assert.equal(profile.mac, '02005e005301');
  assert.equal(profile.controllable, true);
  assert.equal(profile.modeFamily, MODE_FAMILIES.CLASSIC);
  assert.deepEqual(profile.features.mode, [MODES.MANUAL, MODES.AUTO, MODES.NIGHT]);
  assert.deepEqual(profile.features.fanSpeed, { min: 0, max: 91 });
  assert.deepEqual(profile.features.brightness, { min: 0, max: 100 });
  assert.equal(profile.features.pm25, true);
  assert.equal(profile.features.pm10, true);
  assert.equal(profile.features.voc, false);
  assert.equal(profile.features.temperature, false);
  assert.deepEqual(
    { ...readings },
    {
      power: 1,
      fanSpeed: 15,
      mode: MODES.MANUAL,
      brightness: 0,
      childLock: 0,
      filterLife: 45,
      pm25: null,
      pm10: null,
      voc: null,
      co2: null,
      temperature: null,
      humidity: null,
      reportedOnline: true,
    },
  );
  // The latest sensor values travel with the states on this model.
  assert.deepEqual(sensors, {
    values: { pm2_5: 0, fsp0: 15, rssi: -44, pm1: 0, pm10: 0 },
    time: 1736937121,
  });
});

test('Blue Pure 311i Max: auto mode read from automode', () => {
  const { profile, readings } = parse('blue-pure-311i-max.json');
  assert.equal(profile.modeFamily, MODE_FAMILIES.CLASSIC);
  assert.equal(readings.mode, MODES.AUTO);
  assert.equal(readings.childLock, 1);
  assert.equal(readings.filterLife, 88);
  assert.equal(profile.features.pm10, false, 'the 311i Max has no PM10 sensor');
});

test('Protect 7470i: VOC, temperature and humidity sensors; night mode wins over auto', () => {
  const { profile, readings } = parse('protect-7470i.json');
  assert.equal(profile.model, 'Blueair Protect 7470i');
  assert.deepEqual(profile.sensorKeys, {
    pm25: 'pm2_5',
    pm10: 'pm10',
    voc: 'tVOC',
    temperature: 't',
    humidity: 'h',
  });
  assert.equal(readings.fanSpeed, 91);
  assert.equal(readings.filterLife, 50);
  const info = fixture('protect-7470i.json');
  info.states.find((state) => state.n === 'nightmode').vb = true;
  info.states.find((state) => state.n === 'automode').vb = true;
  assert.equal(parseAwsDevice(info, { uuid: info.id }).readings.mode, MODES.NIGHT);
});

test('Signature SP4i: four modes through apsubmode, 0-100 speed', () => {
  const { profile, readings } = parse('signature-sp4i.json');
  assert.equal(profile.modeFamily, MODE_FAMILIES.SIGNATURE);
  assert.deepEqual(profile.features.mode, [MODES.MANUAL, MODES.AUTO, MODES.NIGHT, MODES.ECO]);
  assert.deepEqual(profile.features.fanSpeed, { min: 0, max: 100 });
  assert.equal(readings.mode, MODES.AUTO, 'apsubmode 2');
  const info = fixture('signature-sp4i.json');
  for (const [value, mode] of [
    [0, MODES.MANUAL],
    [1, MODES.MANUAL],
    [3, MODES.NIGHT],
    [4, MODES.ECO],
    [7, null],
  ]) {
    info.states.find((state) => state.n === 'apsubmode').v = value;
    assert.equal(parseAwsDevice(info, { uuid: info.id }).readings.mode, mode, `apsubmode ${value}`);
  }
});

test('2-in-1 DH3i: modes through `mode`, no particle sensor', () => {
  const { profile, readings } = parse('dh3i-2-in-1.json');
  assert.equal(profile.modeFamily, MODE_FAMILIES.COMBO);
  assert.deepEqual(profile.features.mode, [MODES.MANUAL, MODES.AUTO, MODES.NIGHT]);
  assert.deepEqual(profile.features.fanSpeed, { min: 0, max: 91 });
  assert.equal(readings.mode, MODES.AUTO);
  assert.equal(profile.features.pm25, false);
  assert.equal(readings.filterLife, 76);
});

test('ComfortPure T10i: a heater, read only', () => {
  const { profile } = parse('comfortpure-t10i.json');
  assert.equal(profile.controllable, false);
  assert.equal(profile.features.fanSpeed, null, 'no fanspeed state on the 3-in-1');
  assert.equal(profile.features.temperature, true);
});

test('humidifier H35i: three speeds stored as 11/37/64, no filter', () => {
  const { profile, readings } = parse('humidifier-h35i.json');
  assert.equal(profile.humidifier, true);
  assert.deepEqual(profile.features.fanSpeed, { min: 1, max: 3 });
  assert.equal(readings.fanSpeed, null, 'the captured 24 is not a known step');
  assert.equal(profile.features.filterLife, false);
  const info = fixture('humidifier-h35i.json');
  info.states.find((state) => state.n === 'fanspeed').v = 37;
  assert.equal(parseAwsDevice(info, { uuid: info.id }).readings.fanSpeed, 2);
});

test('a state the control schema forgets still counts (H38i-like)', () => {
  const info = fixture('blue-pure-211i-max.json');
  delete info.configuration.dc.childlock;
  assert.equal(parseAwsDevice(info, { uuid: info.id }).profile.features.childLock, true);
  info.states = info.states.filter((state) => state.n !== 'childlock');
  assert.equal(parseAwsDevice(info, { uuid: info.id }).profile.features.childLock, false);
});

test('an unknown SKU, a missing name: sensible fallbacks', () => {
  const info = fixture('blue-pure-211i-max.json');
  info.configuration.di.sku = '999999';
  delete info.configuration.di.name;
  const { profile } = parseAwsDevice(info, { uuid: info.id, name: 'From the list' });
  assert.equal(profile.model, 'Blueair (999999)');
  assert.equal(profile.name, 'From the list');
  assert.equal(modelFromSku('110059'), 'Blueair Blue Pure 211i Max');
  assert.equal(modelFromSku(undefined), null);
});

test('speed bounds by hardware id (blueair_api fan_speed_count)', () => {
  assert.deepEqual(awsSpeedRange('nb_h_1.0'), { min: 0, max: 91 });
  assert.deepEqual(awsSpeedRange('high_1.5'), { min: 0, max: 91 });
  assert.deepEqual(awsSpeedRange('cmb2in1_ii'), { min: 0, max: 91 });
  assert.deepEqual(awsSpeedRange('hum2_l'), { min: 1, max: 3 });
  assert.deepEqual(awsSpeedRange('cmb3in1'), { min: 0, max: 4 });
  assert.deepEqual(awsSpeedRange('l_blue40'), { min: 0, max: 100 });
  assert.deepEqual(awsSpeedRange(''), { min: 0, max: 100 });
});

test('telemetry: the latest non-null value of each sensor; PM divided by 1.32', () => {
  const telemetry = parseTelemetry(fixture('protect-7470i-telemetry.json'));
  assert.equal(telemetry.time, 1747475108);
  assert.deepEqual(telemetry.values, {
    pm1: 0,
    pm2_5: 0,
    pm10: 0,
    tVOC: 134,
    h: 55,
    t: 23,
    fsp0: 91,
  });
  const { profile } = parse('protect-7470i.json');
  assert.deepEqual(awsSensorReadings(profile, { pm2_5: 40, pm10: 66, tVOC: 134, t: 23.5, h: 55 }), {
    pm25: 30,
    pm10: 50,
    voc: 134,
    temperature: 23.5,
    humidity: 55,
  });
  assert.deepEqual(parseTelemetry(null), { values: {}, time: null });
  assert.deepEqual(parseTelemetry([{ sensors: ['pm2_5'], datapoints: [['x', '1']] }]), {
    values: {},
    time: null,
  });
});

test('SenML-like states: the latest record of each name wins', () => {
  const states = latestStates([
    { n: 'standby', vb: true, t: 10 },
    { n: 'standby', vb: false, t: 20 },
    { n: 'standby', vb: true, t: 15 },
    { n: 'fanspeed', v: 37 },
    { n: 'name', vs: 'x', t: 1 },
    { v: 1 },
    null,
  ]);
  assert.equal(states.get('standby').value, false);
  assert.equal(states.get('fanspeed').value, 37);
  assert.equal(states.get('name').value, 'x');
  assert.equal(states.size, 3);
  assert.deepEqual(parseSensorData([{ n: 'pm2_5', v: 'oops', t: 5 }]), { values: {}, time: null });
});

test('historical Classic 480i: fan speed as power, two modes, filter status, sensors', () => {
  const device = legacyClassic480i();
  const { profile, readings } = parseLegacyDevice(device.info, device.attributes, device.listed);
  assert.equal(profile.model, 'Blueair Classic 480i');
  assert.equal(profile.name, 'Classic in the hall');
  assert.equal(profile.mac, 'a0b1c2d3e4f5');
  assert.equal(profile.modeFamily, MODE_FAMILIES.LEGACY);
  assert.deepEqual(profile.features.mode, [MODES.MANUAL, MODES.AUTO]);
  assert.deepEqual(profile.features.fanSpeed, { min: 0, max: 3 });
  assert.deepEqual(profile.features.brightness, { min: 0, max: 4 });
  assert.equal(profile.features.filterLife, false);
  assert.equal(profile.features.filterReplace, true);
  assert.equal(profile.features.co2, true);
  assert.equal(readings.power, 1);
  assert.equal(readings.filterExpired, false);
  assert.equal(readings.reportedOnline, true);

  const off = parseLegacyDevice(
    device.info,
    { ...device.attributes, fan_speed: '0', filter_status: 'Replace', mode: 'auto' },
    device.listed,
  );
  assert.equal(off.readings.power, 0);
  assert.equal(off.readings.filterExpired, true);
  assert.equal(off.readings.mode, MODES.AUTO);

  assert.deepEqual(legacySensorReadings(profile, device.dataPoint), {
    readings: { pm25: 7.5, pm10: 9, voc: 180, co2: 612, temperature: 21.4, humidity: 44 },
    time: 1760000000,
  });
});

test('historical Sense+: no sensor reported, no mode', () => {
  const { profile } = parseLegacyDevice(
    { compatibility: 'sense+' },
    { fan_speed: '1', wifi_status: '1' },
    { uuid: 'X', name: '' },
  );
  assert.equal(profile.model, 'Blueair Sense+');
  assert.equal(profile.name, 'Blueair Sense+');
  assert.equal(profile.hasSensors, false);
  assert.equal(profile.features.mode, null);
  assert.equal(profile.features.pm25, false);
});

test('MAC addresses are compared without separators', () => {
  assert.equal(normalizeMac('02:00:5E:00:53:01'), '02005e005301');
  assert.equal(normalizeMac('02005e005301'), '02005e005301');
  assert.equal(normalizeMac('nope'), null);
  assert.equal(normalizeMac(undefined), null);
});
