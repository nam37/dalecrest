# Dalecrest admin control panel

The panel runs as a separate host service. It reads health from the running village and asks the installed clock helper to change a preset. The helper retains the deploy lock and verifies the running pace. The panel stays available while the village app restarts and records each request and its outcome.

## Sign-in and access

The live panel is at [Dalecrest administration](https://dalecrest.trinsicstudios.com/admin). Route both `/admin` and `/admin/*` to the admin service’s private listener. Preserve the request’s host header and full path. The browser sign-in cookie is issued for `/admin/`. The panel shares the public village's browser origin, so scripts served by either app are trusted by the browser on both. Named operator accounts can change the clock. Monitors can see health and change history.

The host service uses Node.js 22 and runs as the unprivileged `dalecrest-admin` user and group. Install these files from the same release.

| Release files | Host location |
| --- | --- |
| `admin.mjs`, `admin-auth.mjs`, `admin-audit.mjs` and `admin-ui/` | `/opt/dalecrest-admin/` |
| ECharts browser build, license and notice from the deployed image's pinned npm dependency | `/opt/dalecrest-admin/node_modules/echarts/` |
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

## Update the panel

The automatic deploy rebuilds only the village app. It carries changes to `admin-health.mjs` and `admin-metrics.mjs`, which run inside the village container, but never touches the panel itself. After a release changes `admin.mjs`, `admin-auth.mjs`, `admin-audit.mjs` or `admin-ui/`, copy those files from the same release to `/opt/dalecrest-admin/` and restart the service.

```bash
sudo install -m 644 admin.mjs admin-auth.mjs admin-audit.mjs /opt/dalecrest-admin/
sudo cp -r admin-ui/. /opt/dalecrest-admin/admin-ui/
sudo systemctl restart dalecrest-admin.service
```

## Agent URL

Send `GET /admin/api/agent` with the issued key in the header `Authorization: Bearer <name>.<key>`. The response contains village health, the active change if any, and the last 30 clock changes. Agent keys are read-only.

Village health includes `ticks` and `storage`. `ticks.lastTwoHours` and `ticks.lastDay` give the number of ticks and the mean and worst milliseconds for the whole tick and its phases, including `read`, `step`, `events`, `knowledge`, `residents`, `map`, `presence`, `records`, `clock` and `commit`. `total` covers the tick up to the clock update. The next tick records the commit time. The storage sampler runs on its own schedule and database connection. `storage` reports the latest hourly sample of database size and each table’s size and estimated row count, along with daily growth based on the oldest sample in the last week. `logWrittenPerDay` is how much write-ahead log the database writes in a day. Growth reads `null` until two samples are an hour apart. Timings are kept 30 days and size samples 35. Both are missing from a release older than 27 November 2026. Operator sign-in is required for clock changes. [Live agent endpoint](https://dalecrest.trinsicstudios.com/admin/api/agent)

Send `GET /admin/api/agent/metrics` with the same header for the chart data described under [Village trends](#village-trends) and the decision reports below. The panel reads the village at most once a minute, so agents calling more often receive the same figures. Without a key the address answers 401 with `An agent key is required.`

## Decision reports

The `decisions` section of the metrics covers the last 24 real hours. It holds totals only, never a request, reply or resident's memory.

| Field | What it counts |
| --- | --- |
| `freshReasons` | Why each resident needed a fresh choice instead of following a standing instruction. Reasons that name a promise are grouped as `would run into a promise`. |
| `repeats` | For each kind of finished activity, the fresh choices that followed it, and how many chose the same kind of activity with the same job or place again. A high share points to a standing-instruction rule that sends residents back for a choice they already made. |
| `closeCalls` | The gap between the model's two likeliest options in each stored reply, for all residents and for each one: how many fell within 0.1, 0.2 and 0.3, and the median gap. `withoutOdds` counts replies with no probabilities and `unreadable` counts records that could not be read. |
| `menuPosition` | For each place in the menu, how many menus offered an option there and how many times the option there was chosen. Tests of the decisions service showed option order can change its answer. |

`truncated` is true when the day held more than 8,000 decisions and only the most recent were read.

Option positions are not shuffled, so `menuPosition` also reflects how the menu is grouped: protected and work choices come first, and visits, news and leisure last. A low rate at a late position is evidence of order bias only when compared with requests whose order was varied.

## Village trends

- **Daily model tokens** uses real dates in America/New_York. OpenAI totals come from decision traces. Anthropic totals combine goal reviews, song drafts, civic accounts and recorded Daily editor usage. Totals can include estimates where a call did not report usage.
- **Model tokens by resident** ranks the eight highest combined totals over the same 14 Eastern dates, including today. Each bar stacks OpenAI decisions with Anthropic goal reviews and song drafts. Civic accounts and Daily editor charges are village-wide.
- **Daily activities by resident** uses village dates and logged starts from fresh choices and standing instructions. Select a resident to see the last 14 village dates.
- **Daily decision waits** shows the median and 95th percentile in real seconds by the Eastern date the wait began. It opens on the last five days. Select **Last 14 days** for the full history available in the panel. Only waits with a recorded next activity are included.

The current dates are marked in progress. ECharts runs from the panel's own static assets. The chart legend toggles series and each chart has a table of exact values. The panel refreshes charts about once a minute through `GET /admin/api/metrics`, which requires a browser account. The host's `dalecrest-set-clock metrics` command reads the same aggregates from the deployed village container in a read-only transaction.

## Change or restore the pace

Sign in, select 1×, fixed 2×, or day/night, enter a reason, and apply. The table records the operator, requested time, previous and requested paces, and effective pace when verified. A stale request is rejected if another operation changed the pace. Use **Restore** beside a verified change to prepare a new audited change that applies its earlier pace.
