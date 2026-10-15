# Blueair for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and controls **Blueair air purifiers** through the Blueair cloud, the
one the Blueair app uses: air quality, filter life, power, fan speed, modes,
display brightness and child lock — for the current models (Blue Pure Max,
Protect, DustMagnet, HealthProtect, Signature, 2-in-1…) and the first Wi-Fi
generation (Classic i-series, Sense+) alike.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against real answers of the Blueair cloud, captured on real
> devices by [blueair_api](https://github.com/dahlb/blueair_api) — not against
> a purifier or a Blueair account. Please report what works and what does not
> in the [issues](https://github.com/guim31/gladys-blueair/issues).

## Features

- **One device per Blueair device of the account**, with only the features it
  has: **power**, **fan speed** (within the bounds of the model), **mode**
  (manual, auto, night, eco on the Signature series), **display brightness**,
  **child lock**, **filter life** (%), **filter to replace** (at a threshold
  of the configuration), **PM2.5**, **PM10**, **VOC**, **CO2** (Classic),
  **temperature**, **humidity** and **online**.
- The **ComfortPure 3-in-1** (T10i, T20i), which heat, are **read only**: a
  wrong scene must never leave a heater on.
- **Dashboard widget** "Blueair purifiers": every device at a glance (mode and
  PM2.5 colored by air quality, filter to replace, offline) with **All in
  auto** / **All in night**, or one device with live tiles, its power button
  and its modes.
- **Scene trigger** _Blueair filter to replace_: once per filter, kept across
  restarts, with the device name, model and filter life left.
- **Scene action** _Set the Blueair mode_: one device, or every device that
  offers the mode — night mode everywhere at bedtime in one action.
- A **Test the connection** button, a connection status that explains the
  problem (password refused, account locked, profile to complete in the app,
  cloud down), and a **transport badge** per device (cloud, or unreachable).
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A Blueair device set up in the Blueair app, and the **e-mail, password and
  region** of the Blueair account.
- Internet access from Gladys: Blueair devices have no local API.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-blueair`
   (or install **Blueair** from the catalog once it is listed).
2. In **Configuration**, enter the e-mail and password of the Blueair account
   and its region. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Current cloud** (`src/blueair/aws.js`): Gigya (SAP Customer Data Cloud)
  logs the account in (`accounts.login`, then `accounts.getJWT` for a
  short-lived id token), BlueCloud (AWS API Gateway) trades the id token for
  an access token (`POST /prod/c/login`). Then `GET /c/registered-devices`,
  `POST /c/<user>/r/initial` (schema, states and, on some models, the latest
  sensor values), `GET /c/<user>/r/telemetry/5m/historical` (5-minute sensor
  averages) and `POST /c/<device>/a/<attribute>` for the commands.
- **Historical cloud** (`src/blueair/legacy.js`): `api.blueair.io` gives the
  home host of the account, a basic-auth login gives an `X-AUTH-TOKEN`, then
  per device `info`, `attributes`, `datapoint` and `attribute/<name>` writes.
  Most accounts are unknown there: it gives any e-mail a home host, then
  refuses its login. The current cloud is asked first; when it accepts the
  account, a refusal of the historical one just means no device of that
  generation — no error, not asked again until the credentials change. A
  device listed by both clouds (same MAC address) is kept once, on the current
  one.
- **What a device can do** comes from its schema (`dc`/`ds`) and the states it
  reports, following the model families of blueair_api and ha_blueair:
  classic `automode`/`nightmode` booleans, the Signature `apsubmode` (0 manual,
  2 auto, 3 night, 4 eco, paired with the lowest speed like the app), the
  2-in-1 `mode` (1 manual, 2 auto, 3 night), humidifier speeds stored as
  11/37/64, four-gear models on a 0–91 scale. Particle values are divided by
  1.32, like ha_blueair, to match the app.
- **Refresh**: the integration reads the cloud on its own timer (1 to 5
  minutes, 2 by default) — the devices are published with
  `should_poll: false`, because Gladys does not poll external devices reliably
  (GladysAssistant/Gladys#3198) and 2 to 5 minutes is beyond its scheduler's
  list. `onPoll` stays as a fallback. One request per device per cycle, the
  sensor averages at most every 5 minutes, the device list every 6 hours.
  Only the values that changed are sent to Gladys, all of them when a device
  is added or Gladys reconnects, and an unchanged value every 6 hours.
- **Credentials**: the password stays in the Gladys configuration and is only
  sent to Blueair. `/data/blueair-state.json` (mode 600) keeps the Gigya
  session and the access token, so a restart does not log in again, and the
  filters already announced. A refused password stops every request until the
  configuration changes: Gigya locks an account after repeated failed logins.
  An HTTP 429 pauses everything for 10 minutes. Accounts created before
  Blueair made the profile name mandatory (2026-09-22) are completed with the
  profile name, like the app does (ha_blueair#421).
- Logs stay quiet at the default level: start, account connected or lost,
  devices found, offline/online, one line per user command. `LOG_LEVEL=debug`
  shows the rest — never a password, an e-mail or a token.

## Checked, and what was not

- Checked against the real BlueCloud from a development session (2026-10-15):
  its answers to a made-up id token (HTTP 400) and to a made-up access token
  (HTTP 403), now reproduced by the fake cloud of the tests. Gigya and the
  historical cloud were not reachable from that session.
- Tested (113 tests) against the real device captures of blueair_api
  (`test/fixtures/blueair/`), a fake cloud reproducing both APIs, and the fake
  Gladys of the SDK: discovery, states, every command of every model family,
  the trigger, the widget, the logs, the conformity with the feature table of
  the Gladys core.
- **Not checked**: a real login, a real device, the commands on real devices,
  the historical cloud (no capture exists: its fixture is synthetic), the
  ComfortPure and Mini Restful modes, a real Gladys. `scripts/probe.mjs` runs
  the real login path up to the refusal of a made-up account, and a read-only
  listing with a real account (see below).

## Limitations

- Cloud only: nothing works without Internet or when the Blueair cloud is down.
- No real-time updates: the app's MQTT channel is not implemented, changes
  show at the next refresh.
- Not published: PM1 (Gladys has no PM1 sensor), germ shield, night light,
  timer, humidifier wick and water level, the heating and cooling of the
  ComfortPure.
- One region per account; accounts whose devices live in another BlueCloud
  region than the account (rare) are not supported.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Blueair cloud (`test/helpers/fakeBlueair.js`) serving the real
captures of `test/fixtures/blueair/`. See [`CLAUDE.md`](CLAUDE.md) for the
project rules.

Probe of the real clouds (read only, nothing sensitive printed):

```bash
node scripts/probe.mjs eu                       # made-up account, up to the refusal
BLUEAIR_USERNAME=… BLUEAIR_PASSWORD=… node scripts/probe.mjs eu   # real account, read only
```

Releases go through **Actions → Release** (it bumps the versions, moves the
`## [Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md) and builds the
image). A hand-pushed `vX.Y.Z` tag also builds the image, but only after
`version` (and the `docker_image` tag) were bumped by hand in `package.json`
and the manifest.

## Credits

- [blueair_api](https://github.com/dahlb/blueair_api) by Brendan Dahl
  (dahlb), fuatakgun and contributors (MIT): the protocol of both clouds, the
  public application keys, the SKU table, the model families and the device
  captures used as fixtures.
- [ha_blueair](https://github.com/dahlb/ha_blueair), the Home Assistant
  integration by the same authors (MIT): the mapping of fan speeds and preset
  modes, the PM correction, the choice of sensors.
- [hass-blueair](https://github.com/aijayadams/hass-blueair) by Aijay Adams,
  the first reverse-engineering of the historical API (read for
  understanding; no code was copied).
- The architecture and the conformity tests follow
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Blueair AB or
Unilever. "Blueair" is a trademark of its owner.

## License

Apache-2.0
