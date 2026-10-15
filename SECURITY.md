# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes —
in particular how the integration handles the Blueair account:

- the e-mail and password of the Blueair account live in the Gladys
  configuration (the password is a `secret` field). The integration sends them
  only to Blueair (Gigya, `accounts.*.gigya.com` / `accounts.cn1.sapcdm.cn`,
  and the historical `api.blueair.io`), over HTTPS, and never writes them to
  the logs or to disk;
- `/data/blueair-state.json` (readable by the container user only) holds the
  Blueair session, the access token, the home host of the historical cloud and
  the filters already announced — no password, no e-mail (the account is
  identified by a truncated SHA-256 of the e-mail and the region);
- the application keys in `src/blueair/` are the public keys of the Blueair
  app, the same for every user (published in blueair_api): not secrets;
- the integration only makes outgoing HTTPS requests to the Blueair clouds; it
  opens no port and needs no local network access.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Blueair cloud, app and devices, and the third-party services they rely on.
