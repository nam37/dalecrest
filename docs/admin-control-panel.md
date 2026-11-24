# Dalecrest admin control panel

The panel runs as a separate host service. It reads health from the running village and asks the installed clock helper to change a preset. The helper retains the deploy lock and verifies the running pace. The panel stays available while the village app restarts and records each request and its outcome.

## Sign-in and access

The live panel is at [Dalecrest administration](https://dalecrest.trinsicstudios.com/admin). Route both `/admin` and `/admin/*` to the admin service’s private listener. Preserve the request’s host header and full path. The browser sign-in cookie is issued for `/admin/`. The panel shares the public village's browser origin, so scripts served by either app are trusted by the browser on both. Named operator accounts can change the clock. Monitors can see health and change history.

The host service uses Node.js 22 and runs as the unprivileged `dalecrest-admin` user and group. Install these files from the same release.

| Release files | Host location |
| --- | --- |
| `admin.mjs`, `admin-auth.mjs`, `admin-audit.mjs` and `admin-ui/` | `/opt/dalecrest-admin/` |
| `deploy/dalecrest-set-clock` | `/usr/local/sbin/dalecrest-set-clock`, executable and owned by root |
| `deploy/dalecrest-admin.sudoers` | `/etc/sudoers.d/dalecrest-admin`, validated with `visudo` and mode `0440` |
| `deploy/dalecrest-admin.service` | `/etc/systemd/system/dalecrest-admin.service` |

The deployed village image must contain `admin-health.mjs` and `admin-metrics.mjs`. The installed village Compose file must pass both clock settings. Use a root-owned working directory and keep credentials in `/etc/dalecrest-admin`, readable only by the service account and host administrators.

```dotenv
ADMIN_ORIGIN=https://dalecrest.trinsicstudios.com
ADMIN_BASE_PATH=/admin
ADMIN_LISTEN_HOST=127.0.0.1
ADMIN_PORT=4180
ADMIN_VILLAGE_NAME=Dalecrest
ADMIN_CREDENTIALS=/etc/dalecrest-admin/credentials.json
ADMIN_AUDIT_FILE=/var/lib/dalecrest-admin/clock-changes.ndjson
```

Set the origin and path in `/etc/dalecrest-admin/admin.env`. A standalone installation can omit `ADMIN_BASE_PATH` to serve the panel from the root of its own HTTPS host. For a proxy on a private Docker bridge, use the host’s address on that bridge as `ADMIN_LISTEN_HOST`. The service creates a private state directory for the audit journal. Load the unit with `systemctl daemon-reload`, then start it with `systemctl enable --now dalecrest-admin.service`.

## Provision credentials

Generate each account entry on a trusted computer. Pass the password on standard input with a hidden prompt.

```bash
read -rsp 'Account password: ' admin_password
printf '\n'
printf '%s\n' "$admin_password" | node tools/admin-credential.mjs account parish-operator operator
unset admin_password
```

Use the `monitor` role for a read-only browser account. Put the emitted entries in the `accounts` array of `credentials.json`. The `password` field contains a salted hash. The optional `agentKeys` array holds named key digests. The following command prints the key once on standard error and the entry for `agentKeys` on standard output.

```bash
node tools/admin-credential.mjs agent status-agent
```

Restart the admin service after adding or revoking credentials. The audit journal is kept on disk and browser sessions expire on restart.

## Agent URL

Send `GET /admin/api/agent` with the issued key in the header `Authorization: Bearer <name>.<key>`. The response contains village health, the active change if any, and the last 30 clock changes. Agent keys are read-only. Operator sign-in is required for clock changes. [Live agent endpoint](https://dalecrest.trinsicstudios.com/admin/api/agent)

## Village trends

- **Daily model tokens** uses real dates in America/New_York. OpenAI totals come from decision traces. Anthropic totals combine goal reviews, civic accounts, and provider-reported Daily editor usage from the charts release onward. Decision traces, goal reviews and civic accounts can retain estimates where a call did not report usage.
- **Daily activities by resident** uses village dates and logged starts from fresh choices and standing instructions. Select a resident to see the last 14 village dates.
- **Daily decision waits** shows the median and 95th percentile in real seconds by the Eastern date the wait began. Only waits with a recorded next activity are included.

The current dates are marked in progress. Each chart has a table of exact values. The panel refreshes charts about once a minute through `GET /admin/api/metrics`, which requires a browser account. The host's `dalecrest-set-clock metrics` command reads the same aggregates from the deployed village container in a read-only transaction.

## Change or restore the pace

Sign in, select 1×, fixed 2×, or day/night, enter a reason, and apply. The table records the operator, requested time, previous and requested paces, and effective pace when verified. A stale request is rejected if another operation changed the pace. Use **Restore** beside a verified change to prepare a new audited change that applies its earlier pace.
