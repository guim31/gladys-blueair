# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Blueair air purifiers in Gladys, through the Blueair cloud: one device per
  Blueair device of the account, current models (Blue Pure Max, Protect,
  DustMagnet, HealthProtect, Signature, 2-in-1…) and the first Wi-Fi
  generation (Classic i-series, Sense+).
- Power, fan speed within the bounds of the model, modes (manual, auto, night,
  eco on the Signature series), display brightness and child lock, controlled
  from Gladys.
- Air quality (PM2.5, PM10, VOC, CO2 on the Classic models), temperature,
  humidity, filter life, "filter to replace" at a configurable threshold, and
  online state.
- The ComfortPure 3-in-1 heaters are shown read only.
- Dashboard widget "Blueair purifiers": every device at a glance with "All in
  auto" / "All in night", or one device with live tiles, its power button and
  its modes.
- Scene trigger "Blueair filter to replace", once per filter, and scene action
  "Set the Blueair mode", for one device or all of them.
- "Test the connection" button, connection status explaining the problem,
  and a cloud/unreachable badge per device.
- Refresh every 1 to 5 minutes by the integration itself; the Blueair login is
  kept across restarts, and a refused password stops the attempts until the
  configuration changes.
- English, French, German and Spanish, documentation included.

[Unreleased]: https://github.com/guim31/gladys-blueair/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-blueair/releases/tag/v1.0.1
