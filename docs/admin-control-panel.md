# Dalecrest admin control panel

The panel runs as a separate host service. It reads health from the running village and asks the installed clock helper to change a preset. The helper retains the deploy lock and verifies the running pace. The panel stays available while the village app restarts and records each request and its outcome.

## Sign-in and access

Use a dedicated HTTPS URL for the panel. Route its reverse proxy to the admin service’s private listener and preserve the request’s host header. The browser sign-in cookie is scoped to the panel’s host. Named operator accounts can change the clock. Monitors can see health and change history.

The host service uses Node.js 22 and runs as the unprivileged `dalecrest-admin` user and group. Install these files from the same release.

| Release files | Host location |
| --- | --- |
| `admin.mjs`, `admin-auth.mjs`, `admin-audit.mjs` and `admin-ui/` | `/opt/dalecrest-admin/` |
| `deploy/dalecrest-set-clock` | `/usr/local/sbin/dalecrest-set-clock`, executable and owned by root |
| `deploy/dalecrest-admin.sudoers` | `/etc/sudoers.d/dalecrest-admin`, validated with `visudo` and mode `0440` |
| `deploy/dalecrest-admin.service` | `/etc/systemd/system/dalecrest-admin.service` |

The deployed village image must contain `admin-health.mjs`. The installed village Compose file must pass both clock settings. Use a root-owned working directory and keep credentials in `/etc/dalecrest-admin`, readable only by the service account and host administrators.

```dotenv
ADMIN_ORIGIN=https://admin.dalecrest.example
ADMIN_LISTEN_HOST=127.0.0.1
ADMIN_PORT=4180
ADMIN_VILLAGE_NAME=Dalecrest
ADMIN_CREDENTIALS=/etc/dalecrest-admin/credentials.json
ADMIN_AUDIT_FILE=/var/lib/dalecrest-admin/clock-changes.ndjson
```

Use the actual admin HTTPS origin in `/etc/dalecrest-admin/admin.env`. For a proxy on a private Docker bridge, use the host’s address on that bridge as `ADMIN_LISTEN_HOST`. The service creates a private state directory for the audit journal. Load the unit with `systemctl daemon-reload`, then start it with `systemctl enable --now dalecrest-admin.service`.

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

Send `GET /api/agent` to the admin HTTPS origin with the issued key in the header `Authorization: Bearer <name>.<key>`. The response contains village health, the active change if any, and the last 30 clock changes. Agent keys are read-only. Operator sign-in is required for clock changes.

## Change or restore the pace

Sign in, select 1×, fixed 2×, or day/night, enter a reason, and apply. The table records the operator, requested time, previous and requested paces, and effective pace when verified. A stale request is rejected if another operation changed the pace. Use **Restore** beside a verified change to prepare a new audited change that applies its earlier pace.
