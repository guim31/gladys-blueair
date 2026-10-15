# Blueair fixtures

## `aws/` — real answers of the current Blueair cloud

The `deviceInfo[0]` of `POST /prod/c/<user>/r/initial` for seven devices, and
one answer of `GET /prod/c/<user>/r/telemetry/5m/historical`, captured on real
devices by the contributors of [dahlb/blueair_api](https://github.com/dahlb/blueair_api)
(MIT licence, copyright fuatakgun and contributors) in its `tests/device_info`
folder.

| File                           | Source file in blueair_api   | Device                        |
| ------------------------------ | ---------------------------- | ----------------------------- |
| `blue-pure-211i-max.json`      | `max_211i.json`              | Blue Pure 211i Max            |
| `blue-pure-311i-max.json`      | `max_311i.json`              | Blue Pure 311i Max            |
| `protect-7470i.json`           | `protect_7470i.json`         | Protect 7470i                 |
| `protect-7470i-telemetry.json` | `protect_7470i_sensors.json` | its 5-minute sensor averages  |
| `signature-sp4i.json`          | `SP4i.json`                  | Blue Signature SP4i           |
| `dh3i-2-in-1.json`             | `two_in_one_dh3i.json`       | 2-in-1 Purify + Humidify DH3i |
| `comfortpure-t10i.json`        | `T10i.json`                  | ComfortPure 3-in-1 T10i       |
| `humidifier-h35i.json`         | `H35i.json`                  | Humidifier H35i               |

Anonymized for this public repository: device ids replaced by
`00000000-0000-4000-8000-…` UUIDs (in the topic names too), MAC addresses by
`02:00:5e:00:53:xx`, serial numbers by the SKU followed by zeros, device names
by room names, signatures zeroed, the factory Wi-Fi block (`fc`) and the
"welcome home" address removed, the time zone set to `Europe/Paris`. The
telemetry keeps its last 12 data points. Everything else is as captured.

## Historical cloud

blueair_api publishes no capture of the historical cloud (api.blueair.io). The
Classic 480i of `test/helpers/fakeBlueair.js` is **synthetic**: its shapes
(attribute list, data point columns `time, pm, pm1, pm10, tmp, hum, co2, voc,
allpollu`, the `X-AUTH-TOKEN` login) follow the code of blueair_api, its values
are made up.

## Answers of the real BlueCloud to a made-up token

Probed from a development session on 2026-10-15, reproduced by the fake cloud:
`POST /prod/c/login` with an invalid id token answers HTTP 400
`{"message":"Token invalid or Request Timeout"}`; a request with an invalid
access token answers HTTP 403 `{"Message":"User is not authorized to access
this resource because no identity-based policy allows the execute-api:Invoke
action"}`.

## Answer of the real historical cloud to an unknown e-mail

Probed on 2026-10-15 from a machine with network: `GET /v2/user/<e-mail>/homehost/`
answers a home host even for a made-up e-mail, and its login is then refused.
The fake cloud does the same by default (`unknownHomeHost = 'host'`); the 404
blueair_api also handles is `unknownHomeHost = '404'`.
