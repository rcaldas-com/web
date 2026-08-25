# rcaldas `web` app

Next.js app deployed as `registry.rcaldas.com/rcaldas/web` from
`/var/rcaldas/rcaldas/docker-compose.prod.yml` on the production server `us`
(SSH alias `us`, see `~/.ssh/config`). **Deploy é por pipeline desde
25/08/2026** — commit no repo dispara build num worker, a promoção escreve
a tag no `docker-compose.prod.yml` e o host reconcilia. Ver `CICD.md`. A
imagem ainda pode ser construída à mão, mas não é mais o caminho normal. `web`, `wallet`, and `emailer`
services all share one `.env` file at `/var/rcaldas/rcaldas/.env`.

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
  - `GET /sync-dotfiles` (`app/sync-dotfiles/route.ts`) is a separate,
    lighter, manually-run script (`curl -fsSL .../sync-dotfiles | sudo
    bash`) that does just that symlink conversion, for converting an
    already-provisioned host to live-synced dotfiles/bin scripts without
    a full `/init` re-run.
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
`/var/rcaldas/rcaldas/.env` on `us`, never commit them): `CF_TOKEN` / `CF_ZONE_ID`
(Cloudflare, for centralized DDNS), `MAILU_API_TOKEN` / `MAILU_API_URL` /
`MAILU_FORWARD_TO`, `PROVISION_TOKEN` (shared secret gating
`/api/mailu-account`).

**Hostnames — qual serve o quê (revisado em 22/08/2026):**

Este app é servido por vários hostnames, e a diferença entre eles **não é
cosmética**: define se a requisição passa pela Cloudflare.

| hostname | Cloudflare | papel |
|---|---|---|
| `web.rcaldas.com` | proxied | canônico do app; é pra onde `AUTH_TRUST_HOST` aponta e pra onde os agentes da frota mandam heartbeat |
| `rcaldas.com` | proxied | mesmo app + `/static/` + links curtos (`app/[slug]`) |
| `up.rcaldas.com` | **DNS-only** | só `/upload`, `/digitar` e suas APIs |

O `up` existe porque o plano Free da Cloudflare impõe dois limites **na
borda**, antes do HAProxy ver qualquer coisa — nenhuma config da origem
contorna:

- **corpo > 100MB → 413.** Medido: 120MB em `rcaldas.com` dá 413; os
  mesmos 120MB em `up.rcaldas.com` chegam na origem.
- **resposta > 100s → 524.** Atinge o OCR de PDF do DigitaR.

O HAProxy redireciona a **página** (`/upload`, `/digitar`) pro `up` e
manda de volta pro `web` qualquer outro path pedido no `up` — senão o app
inteiro ficaria alcançável por um hostname sem WAF. `/login` fica de fora
dessa liberação de propósito: quem não tem sessão faz login atrás do WAF e
só volta pro `up` já autenticado. O cookie de sessão é setado em
`.rcaldas.com` (`lib/auth.ts`), então a sessão atravessa os três.

⚠️ Não "simplifique" tirando o `up` e desligando o proxy do
`web.rcaldas.com` inteiro — foi o que se fez em 17/08 e custou cache de
borda e WAF do app todo por causa de dois endpoints.

**Infra outside this repo (server `us`):**
- HAProxy: `init.rcaldas.com` maps to the `rcaldas-web` backend via
  `~/live/haproxy/hosts.map` (live path
  `/var/rcaldas/live/haproxy/us.haproxy`), with an
  `http-request set-path /init if { hdr(host) -i init.rcaldas.com }
  { path / }` rule so the old one-liner keeps working. Reload with
  `systemctl reload haproxy` after editing.
- `web` service in `docker-compose.prod.yml` has a `ro` bind mount of
  `/var/rcaldas/live/home` and is joined to `mailu_default`.
- Central log collector: `/etc/rsyslog.d/10-collector.conf` on `us` binds
  `imtcp` to **127.0.0.1 only** and writes `/var/log/remote/<host>/syslog.log`
  (keyed on the syslog HOSTNAME, not the source IP — through the tunnel every
  host arrives as 127.0.0.1). Hosts reach it via the `-L 5514:127.0.0.1:514`
  the agent adds to its own reverse tunnel. Retention is deliberately short
  (`/etc/logrotate.d/rcaldas-remote`, 7 days, `maxsize 200M`) because `/var`
  on `us` is tight; long-term history is supposed to come from the backup.

**Recuperar acesso a um host cuja chave não conhecemos** (procedimento
usado para o `lev`, que só fala o protocolo zxnet antigo e não tinha chave
autorizada em `/var/zxnet/.ssh/authorized_keys`):

O `sshd` pode entregar a chave que o cliente está *oferecendo* a um script
via `AuthorizedKeysCommand ... %t %k`. Como ele **só consulta o comando
quando a chave não está no `authorized_keys`**, nenhum túnel existente é
afetado. O script pode devolver a chave oferecida como autorizada, o que
aceita o host cegamente — daí a trava obrigatória: um `Match User zxnet
Address <ip-do-host>` (mais específico, inserido **antes** do
`Match User zxnet` genérico) e `restrict,port-forwarding` na linha
devolvida, para valer só para aquele IP e só para abrir túnel, nunca shell.

Riscos e cuidados: é aceitação cega enquanto estiver ativo, e IP
residencial é dinâmico — remover assim que a chave real estiver gravada.
Sempre `cp` do `sshd_config`, `sshd -t` antes de aplicar, e `reload` (não
`restart`) para não derrubar as sessões existentes.

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

**`script()`'s bash text lives inside an untagged JS template literal —
every literal `\` or `${` you write for the served script goes through
one JS escape pass before it ever reaches the target host.** Bitten
twice by this in one night:
- A `sed 's/\\/\\\\/g; ...'` JSON-escaping script had its backslashes
  silently halved by JS's `\\` → `\` collapse, breaking every heartbeat
  from every already-installed agent (400 "host is required", nothing in
  `monitor_hosts`) until caught by actually running the installed script
  and comparing sed output byte-for-byte against what the source
  *should* produce.
- `"${var_dev:-}"` (a bash default-value expansion) broke `next build`
  outright — TS tried to parse `var_dev:-` as a JS expression inside
  `${...}`. Existing code already has the fix pattern for this exact
  case (see `APP_URL="${'$'}{APP_URL:-...}"` etc. throughout
  `AGENT_BIN`): wrap the literal `$` as `${'$'}` so only that inner
  `'$'` is real JS, and the following `{...}` passes through untouched.
When adding *any* bash line with `\` or `${` here or in `app/init/route.ts`,
double-check it survives the JS pass — don't just eyeball it, actually
diff the served output against what you intend (`printf '%b'` locally
approximates the `\\`-collapse rule closely enough to catch it before a
build or a deploy does).

**Second trap in the same file: `/install` serves TWO scripts with
separate variable scopes.** The outer installer, and the agent it writes
via `cat > "$AGENT_BIN" <<'EOF'` (quoted heredoc — nothing expands at
install time). Variables defined inside the agent (`LOG`, `VERSION`,
`LOG_FORWARD_PORT`, …) do **not** exist in the installer. Both scripts
run under `set -euo pipefail`, so referencing one from the other is a
*fatal* unbound-variable error, and because `cat > file <<EOF` truncates
the target before expanding, it leaves an **empty config file behind and
aborts mid-install** — the agent silently stays on its old version while
the run looks like it merely printed a warning. Hit twice: once with
`$LOG`, once with `$LOG_FORWARD_PORT`. Anything needed by both must be
declared in the installer scope (top of the file, next to `CONFIG_DIR`)
and passed into the agent through `config.env`.

**Still open / next steps:** the DDNS toggle and tunnel-request flow in
`/monitor` have now been exercised end-to-end against a real host
(`tp`) — this surfaced and fixed the two escaping bugs above, a token-
reissue bug for hosts pre-created via the "novo host" form (server
generated a token but only returned it to the agent when the host doc
was brand new, so pre-created hosts got permanently 401'd after their
first heartbeat), and a DDNS bug where the Cloudflare record was only
touched on IP *change*, never on first enabling `ddnsEnabled` for an
already-stable host. The tunnel-request UX was also redesigned: hosts
now get an auto-assigned `tunnelPort` (next free from 7701, checked
against other hosts so two never collide on the shared relay) and a
single "abrir túnel" action replaces the old toggle-then-type-a-port-
then-click-pedir flow, which had zero user-facing feedback on failure.
Not yet done: retiring the old `rcaldas-com/init` / `rcaldas-init` Docker
service (still unused but not archived). Alerting is now live: thresholds
(`monitoring.diskThresholdPct`/`memoryThresholdPct`/`cpuThresholdPct`) open
and resolve incidents in `monitor_incidents` and email the admin on the
*transition* (never per-heartbeat). Incident creation is source-agnostic —
any heartbeat result with `type: "alarm"` becomes an incident, so a Netdata
alarm relayed from `127.0.0.1:19999/api/v1/alarms` would drop in without
server changes. `cpuPct` is a real average over the interval since the last
heartbeat (delta of `/proc/stat` via a state file), in the provider's unit
where 100% = one core — deliberately so it can be compared to (and beat)
Linode's own alert, which only averages over 2 hours.

## Módulo de serviços (implementado — ver `CICD.md`)

O monitoramento por **host** (disco, CPU, memória, túnel, backup) ganhou
um irmão por **serviço**: `monitor_services`, em `/monitor/servicos`. O
registro nasce derivado do `docker compose` do host de produção, não
digitado — inventário digitado à mão apodrece, e o caso do fail2ban abaixo
é a prova. O que se edita à mão é só o que a máquina não tem como saber:
origem do artefato, caminho do log, URL, auto-promoção.

O inventário abaixo foi o levantamento que originou o módulo; hoje a parte
de imagem/host/estado vem sozinha do agente.

A ideia central, que apareceu de um caso real: hoje a jail `mongodb-auth`
do fail2ban no `us` apontava pra `/var/mongodb/logs/mongodb.log`, mas o
deploy do Mongo tinha mudado pra `/var/rcaldas/mongodb/logs/`. Ninguém
percebeu até um restart derrubar o fail2ban inteiro. **Esse tipo de
informação — onde o serviço está deployado, onde ele loga — pertence ao
cadastro do serviço no Monitor**, e o Monitor passa a usar isso pra
configurar os fail2ban de forma centralizada, em vez de cada host ter
caminhos hardcoded que silenciosamente apodrecem.

### Inventário atual (levantado pelo usuário — base do cadastro)

Tudo roda no `us`. Os caminhos são o que o cadastro do serviço deve
guardar; hoje eles só existem espalhados por config de fail2ban, compose e
memória.

| Serviço | Endereço | Caminho | Notas |
|---|---|---|---|
| **haproxy** | — | `/var/rcaldas/live/haproxy` | entrada de tudo; é onde ficam as proteções (rate limit, ACL da Cloudflare) |
| **mongodb** | `mongo.rcaldas.com:8417` + registro SRV | `/var/rcaldas/mongodb` | dados em `db/` — **excluir do backup de config**, vão por `mongodump` no backup de dados |
| **RC Web** | `web.rcaldas.com` (e `rcaldas.com` quando o legado cair) | `/var/rcaldas/rcaldas`, serviço `web` | este app |
| **Car App** | `car.rcaldas.com` | `/var/rcaldas/rcaldas`, serviço `car` | veio do repo `car-dev`, aposentado |
| **Wallet** | `wallet.rcaldas.com` | `/var/rcaldas/rcaldas`, serviço `wallet` | mesmo compose do RC Web |
| **CCXT** | interno | `/var/rcaldas/rcaldas` | |
| **emailer** | interno | um só pra toda a stack — a identidade do app vai no payload da mensagem | fila de email |
| **redis** | interno | um só, compartilhado | |
| **S3** | externo | — | usado por car, wallet e backup; RC Web vai usar em breve. Se monitorar como serviço ainda está em aberto |
| **Mailu** | MX `us.rcaldas.com` | `/mailu` | só SMTP; IMAP/POP desativados de propósito |
| **Webssh** | `us.rcaldas.com` | `/var/rcaldas/webssh` | `wssh --address='127.0.0.1' --policy=reject --port=8899` — **script manual em background** |
| **Webvnc** (noVNC) | `acesso.rcaldas.com` | `/var/rcaldas/webvnc` | `./utils/novnc_proxy --vnc localhost:7759 --listen localhost:6081` — **script manual em background** |

Dois pontos que o cadastro deve atacar primeiro, porque já são fragilidade
conhecida:

- **Webssh e Webvnc rodam por script manual em background** — sem systemd,
  sem restart automático, sem log rotacionado. Um reboot do `us` derruba os
  dois silenciosamente, e são justamente as ferramentas de acesso de
  emergência. Viraram unit de systemd é o conserto óbvio.
- **Rota de hostname é fácil de esquecer.** Um domínio habilitado para
  links curtos no Monitor **também precisa de entrada no `hosts.map` do
  HAProxy** — sem ela cai no backend `Default`, que redireciona pra
  `rcaldas.com`, e o link de upload simplesmente não baixa. Aconteceu com
  o `123lucro.com` (o `hosts.map` tinha só o `.online`, que nem DNS tem).
  O cadastro do domínio e a rota são dois lugares hoje.

Outros itens que caem nesse módulo:
- Backup de serviço (dump do Mongo, buckets S3 de produção) — hoje coberto
  à mão por `rcaldas/scripts/restore_prod.sh`.
- Rotação de log por serviço: `/var/rcaldas/mongodb/logs/mongodb.log`
  estava com **834MB sem rotação** (mesmo padrão dos logs de host que já
  foram corrigidos).
- Nota: `car` e `wallet` são apps irmãos (mesmo padrão de código, mesmo
  Mongo, mesmo emailer) e usam as `S3_*` de produção — por isso o backup
  precisa de um bucket/credenciais **separados** (`BACKUP_S3_*`), nunca o
  mesmo bucket que guarda o dado a ser copiado.
