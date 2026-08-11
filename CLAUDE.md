# rcaldas `web` app

Next.js app deployed as `registry.rcaldas.com/rcaldas/web` from
`/var/rc-web/docker-compose.prod.yml` on the production server `us`
(SSH alias `us`, see `~/.ssh/config`). **Deploys are pre-built images —
the user builds and pushes new versions themselves; code changes here
don't go live until that happens.** `web`, `wallet`, and `emailer`
services all share one `.env` file at `/var/rc-web/.env`.

Modules in this app: user management/auth, finance ("saldo disponível",
cartões), "habitar", "digitar", and — as of this work — host provisioning
and monitoring (below). If you're picking up finance/habitar/digitar work
specifically, treat this file's monitor/init section as background, not
required reading.

## Host provisioning + monitoring/DDNS system (`/init`, `/install`, `/monitor`)

This replaced an older, separate Flask app + Docker service
(`rcaldas-com/init` repo, image `registry.rcaldas.com/rcaldas/init`) that
served `curl init.rcaldas.com | bash` and had gone stale for ~2 years.
That repo/service is retired (not deleted — candidate for archival).

**Two entry points, one flow:**
- `GET /init` (`app/init/route.ts`) — full host provisioning: creates the
  `rcaldas` user (fixed uid 8484), SSH, packages, mail relay, Docker,
  Syncthing, desktop tools. Ported from a legacy `init.sh` and modernized
  for Debian 13. Ends by chaining into `/install` so a freshly
  provisioned host also gets monitoring/DDNS in one command.
- `GET /install` (`app/install/route.ts`) — monitoring/DDNS agent only
  (for hosts that don't need full provisioning). Installs a systemd timer
  that heartbeats every 60s to `/heartbeat`, and processes `tunnel` jobs
  returned in the heartbeat response to open on-demand SSH reverse
  tunnels.
- `GET /monitor` (`app/monitor/page.tsx`, admin-only) — dashboard: list
  hosts, toggle `ddnsEnabled`/`tunnelEnabled` per host, create/delete
  hosts, request a tunnel.

**Design decisions worth knowing before touching this:**
- Dotfiles, `authorized_keys`, and personal scripts under `live/bin` are
  NOT static files in this repo. `/init` reads them **live, at request
  time**, straight from `/var/rcaldas/live/home` and `/var/rcaldas/live/bin`
  on the `us` server (Syncthing-synced across all the user's hosts) and
  bakes the current content into the served script. This means a brand
  new host gets real keys/dotfiles immediately, with zero dependency on
  its own Syncthing being set up yet.
  - BUT: `set_user()` in `app/init/route.ts` still checks whether
    `$SYNC_HOME`/`$SYNC_BIN` already exist *locally* on the target host
    (meaning Syncthing was configured there since a previous run) and
    symlinks from those instead if so. Don't remove this check — without
    it, re-running `/init` on an already-synced host destroys the live
    symlinks and replaces them with a static snapshot again.
  - `scripts/sync-dotfiles.sh` is a separate, lighter, manually-run
    script that does just that symlink conversion, for converting a host
    without a full re-provision.
- DDNS is centralized server-side (`lib/monitor.ts`): the agent just
  reports IPv6 in its heartbeat; the server updates a Cloudflare AAAA
  record — but **only** for hosts with `ddnsEnabled: true` already set.
  This is a deliberate gate: without it, any heartbeat with a made-up
  hostname could get DNS control over that name. Same pattern for
  `tunnelEnabled`. Set via the `/monitor` UI, not automatically.
- `/install`'s `ask()`/`ask_bool()` **must** read from `< /dev/tty`, not
  plain stdin. When run via `curl | bash` (its only real usage), stdin
  *is* the incoming script bytes — a plain `read` steals unconsumed
  script source as fake input and desyncs everything downstream,
  including heredocs. This caused a real `AGENT_TOKEN: unbound variable`
  crash in production before being fixed. If you ever add a new prompt
  here or in `app/init/route.ts`, use `read < /dev/tty`.
- `/install` sources any existing `/etc/rcaldas-agent/config.env` before
  asking, using previous values as defaults (host name, token, tunnel
  pref) — otherwise re-running on an already-registered host always sent
  an empty token and got rejected with 401.
- Mailu account creation (`app/api/mailu-account/route.ts`): `/init`'s
  `set_smtp()` used to just print a generated SMTP relay password for
  manual copy-paste into Mailu. Now it POSTs here, and the server creates
  a forward-only mailbox (no IMAP/POP, forwards to Gmail — matches every
  other domain on this Mailu instance, which never does real mail
  storage). The Mailu admin API is **only reachable over the internal
  `mailu_default` Docker network** (its public hostname routes elsewhere
  entirely via HAProxy) — `web`'s compose service had to join that
  network, same as `emailer` already does. The Mailu admin token never
  reaches the provisioned host; `/init` authenticates to this endpoint
  with a shared `PROVISION_TOKEN` instead (same trust level
  `authorized_keys` already implicitly has — anyone who can fetch `/init`
  already receives SSH keys).

**Secrets** (names/purpose only — actual values live only in
`/var/rc-web/.env` on `us`, never commit them): `CF_TOKEN` / `CF_ZONE_ID`
(Cloudflare, for centralized DDNS), `MAILU_API_TOKEN` / `MAILU_API_URL` /
`MAILU_FORWARD_TO`, `PROVISION_TOKEN` (shared secret gating
`/api/mailu-account`).

**Infra outside this repo (server `us`):**
- HAProxy: `init.rcaldas.com` maps to the `rcaldas-web` backend via
  `~/live/haproxy/hosts.map` (live path
  `/var/rcaldas/live/haproxy/us.haproxy`), with an
  `http-request set-path /init if { hdr(host) -i init.rcaldas.com }
  { path / }` rule so the old one-liner keeps working. Reload with
  `systemctl reload haproxy` after editing.
- `web` service in `docker-compose.prod.yml` has a `ro` bind mount of
  `/var/rcaldas/live/home` and is joined to `mailu_default`.

**Real-world bugs already found and fixed** (from actually running
`/init` on physical Debian 13 laptops — don't reintroduce these):
`ntp` doesn't exist in Debian 13 and silently aborts the *entire*
`default_apps` apt batch (one bad package name breaks everything in the
list, not just itself) — using `chrony` now. Firefox: Mozilla serves
`.tar.xz` now, not `.tar.bz2`. `/etc/sysctl.conf` doesn't exist on a
fresh Debian 13 install — swappiness/inotify tuning lives in
`/etc/sysctl.d/*.conf` drop-ins instead. `gpg --dearmor -o
docker.gpg` prompts interactively on a second run unless `--yes` is
passed (plain `curl -o` downloads don't have this problem). The embedded
Firefox icon's base64 payload can get silently truncated by editing
tools if handled carelessly — if it ever breaks again, re-extract from
git history rather than re-typing it.

**Still open / next steps:** the DDNS toggle and tunnel-request flow in
`/monitor` have been code-reviewed and unit-verified but not yet
exercised end-to-end by the user through the actual UI (needs an admin
login session). The old `rcaldas-com/init` repo and `rcaldas-init` Docker
service are unused but not yet formally archived/removed.
