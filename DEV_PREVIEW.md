# Local dev preview — Multica

Backend + web run natively; the database is the **exact Postgres of Docker
deployments** (`pgvector/pgvector:pg17`), run under **Podman** with `pg_bigm`
built on top (see `docker/pg17-bigm.Containerfile` — upstream pg_bigm 1.2 only
supports up to PG16, PG17 support is on master).

## What's running

| Component | How | Where |
|---|---|---|
| PostgreSQL 17 | Podman container `multica-postgres`, image `multica-postgres:pg17-bigm`, named volume `multica_pgdata` | `127.0.0.1:5432`, db `multica`, user `multica` / `multica` |
| Go backend | tmux session `multica:api` → `server/bin/server` | http://localhost:8080 (`/health` returns JSON) |
| Next.js web | tmux session `multica:web` → `next dev --webpack --port 3000` | http://localhost:3000 |
| Agent daemon | tmux session `multica:daemon` → `bin/multica daemon start --profile dev-local` | profile `~/.multica/profiles/dev-local`, task workspaces `~/multica_workspaces_dev-local` |

**Why tmux (not launchd) for api/web/daemon:** launchd-spawned processes on this
machine used to get macOS TCC `Operation not permitted` when touching the
external-SSD checkout (`/Volumes/ExternalSSD/projects/Github/APIS`), so they
hung in dyld at startup. A tmux server started from a normal shell keeps that
shell's TCC grant. **Update 2026-10-03:** the LaunchAgents below (api/web,
`nl.sjoerd.squad-ui-dev`, `nl.sjoerd.squad-agui-dev`) all run directly from the
SSD checkout without issue — treat the tmux requirement as historical; the
plist route is now the primary one. The Postgres launchd plist still works
(Podman is installed under /opt/homebrew, no SSD access needed).
Start everything with: `~/dev-bin/multica-dev-start.sh` (idempotent; needs
`/opt/homebrew/bin` in PATH).

Installed extensions in the container: `pgcrypto`, `pg_trgm`, `pg_bigm` (built
from master), `vector` 0.8.6 — everything Multica's migrations can use, including
the bigram GIN search indexes that Homebrew Postgres had to skip.

## Login

`dev@localhost` with verification code `888888` (from `MULTICA_DEV_VERIFICATION_CODE` in `.env`;
APP_ENV is unset so it is honored). A workspace named **Dev Workspace** (slug `dev-workspace`)
already exists. No email sending is configured — codes print to the API log.

The login page shows a banner with these credentials automatically: the API's
public `/api/config` includes `dev_login_hint` only for non-production servers
with a valid six-digit dev code, and only for requests from the machine itself
(loopback), so a LAN-exposed dev server does not leak the code.

## Agent daemon & runs

The daemon connects this machine as a runtime and executes agent tasks.

- Profile: `~/.multica/profiles/dev-local/config.json` (PAT for `dev@localhost`,
  server `http://localhost:8080`, workspaces root `~/multica_workspaces_dev-local`).
- It registered runtimes for every agent CLI found on the machine (claude, codex,
  cursor, hermes, pi, omp, kiro, antigravity) — all **online** in the workspace.
- Demo agent **Hermes Dev** runs on the Hermes runtime via OpenRouter
  (`hermes auth add openrouter --api-key ...` was used to store the key from
  `~/.zshrc`; the daemon copies the Hermes credential pool into each task's
  `hermes-home`).
- First real run: issue **DEVW-8** was assigned to Hermes Dev; the daemon spawned
  Hermes in a task sandbox (`~/multica_workspaces_dev-local/.../devw-8-*/`), the
  run completed, and the agent posted its blocker report as a comment and moved
  the issue to *blocked* — the full assign → run → comment → status lifecycle.
  (No repo was linked to the issue's project, so the agent correctly asked for
  one instead of inventing work.)

The daemon can also run under launchd (verified 2026-10-02 — it only touches
$HOME, so the SSD TCC constraint doesn't apply):
`launchctl submit -l multica-daemon-dev-local -- /bin/sh -c "exec ~/dev/multica/server/bin/multica daemon start --foreground --profile dev-local > /tmp/multica-daemon-dev-local.log 2>&1"`
(stop with `launchctl remove multica-daemon-dev-local`). This survives reboots;
the nohup/detached-shell variant gets reaped by some process supervisors.

Rebuild the daemon binary after pulling server changes:
`cd multica/server && go build -o bin/multica ./cmd/multica`, then restart the
`multica:daemon` tmux window (the daemon re-execs this binary for every task).

## Everyday commands

```bash
# status
launchctl list | grep multica
curl -s localhost:8080/health

# stop
podman stop multica-postgres
export PATH="/opt/homebrew/bin:$PATH"
tmux kill-session -t multica

# start again
launchctl bootstrap gui/501 ~/Library/LaunchAgents/ai.multica.dev.postgres.plist 2>/dev/null || true
~/dev-bin/multica-dev-start.sh
```

After editing server code: `cd multica/server && go build -o bin/server ./cmd/server && go build -o bin/multica ./cmd/multica`, then restart the tmux windows:
`tmux send-keys -t multica:api C-c 'while true; do ./bin/server; sleep 2; done' Enter` (same shape for `web` and `daemon`).

## Squad integration (squad-multica bridge)

The squad stacks consume Multica through `../../squad-multica` (maps Multica
WS/CLI events onto the squad `DispatchEvent` contract). Wiring, verified
end-to-end 2026-10-03 (issue DEVW-14: queued → dispatched → running → tool
calls → completed, streamed live):

- **Agent daemon as LaunchAgent**: `launchctl submit -l multica-daemon-dev-local -- /bin/sh -c "exec $HOME/dev/multica/server/bin/multica daemon start --foreground --profile dev-local > /tmp/multica-daemon-dev-local.log 2>&1"` (survives reboots; remove with `launchctl remove multica-daemon-dev-local`).
- **squad-agui as LaunchAgent**: `~/Library/LaunchAgents/nl.sjoerd.squad-agui-dev.plist` (port 4930, KeepAlive, mise node 24). Health: `curl localhost:4930/healthz`.
- **Watch the bridge live**: `curl -sN localhost:4930/run?live=multica` (AG-UI SSE; also the `multica · daemon` source in squad-ui on :4931). squad-agui spawns `squad-multica/src/bridge.ts` and kills it when the SSE client disconnects — the bridge itself is not a resident process.
- **Secrets**: the bridge auto-reads `~/.multica/profiles/dev-local/config.json`
  (chmod 600) for `server_url`/`workspace_id`/token; `MULTICA_PROFILE` picks a
  different profile and explicit `MULTICA_SERVER_URL`/`MULTICA_WORKSPACE_ID`/
  `MULTICA_WS_TOKEN` env still win. No tokens live in env files or plists.
- **Usage tokens** ride only the CLI-poll source (`MULTICA_POLL_ISSUE=DEVW-14 npx tsx src/bridge.ts` from `squad-multica/`) — WS task frames don't carry usage.

## Verification (typecheck / unit tests / Go tests)

Verified 2026-10-01: typecheck 10/10 packages, TS unit tests 5950/5950, Go suite
67 packages ok (`go vet` clean too).

```bash
# TS typecheck + unit tests (turbo, excludes mobile) — run from multica/
pnpm typecheck
pnpm test

# Go suite against a throwaway DB (keeps the seeded demo DB untouched)
podman exec multica-postgres psql -U multica -d postgres \
  -c "DROP DATABASE IF EXISTS multica_test WITH (FORCE);" \
  -c "CREATE DATABASE multica_test OWNER multica;"
cd server && DATABASE_URL="postgres://multica:multica@localhost:5432/multica_test?sslmode=disable" go run ./cmd/migrate up
cd .. && DATABASE_URL="postgres://multica:multica@localhost:5432/multica_test?sslmode=disable" bash scripts/test-go.sh
```

Gotchas learned the hard way on this machine:

- **Run plain `pnpm`, not `corepack pnpm`.** A global pnpm 11.28.2 sits on PATH;
  plain pnpm auto-switches to the pinned 10.28.2, but under corepack it refuses
  to self-switch, so every turbo-spawned `pnpm run mdx`/`test` subprocess dies
  on pnpm's version guard and `pnpm typecheck` fails in <1s. (The `pnpm` field
  WARN in package.json is pre-existing noise.)
- **Migrate the test DB first** — `scripts/test-go.sh` does not apply migrations,
  so a fresh `multica_test` fails with `relation "user" does not exist`.
- **Load/ENOSPC flakes** (observed while the 200 GB system disk sat at 100 MB
  free with 16.6 GB swap): `internal/daemon/repocache` intermittently fails with
  `stop process tree: operation not permitted` (EPERM from the processtree
  teardown's `kill(-pgid, 0)`; passes solo and in co-run re-runs), and
  `pkg/agent` Codex tests with ~70–100 ms timeouts can miss their deadline. Both
  pass on retry; if TempDir creation fails with `no space left on device`, free
  disk first (the 16 GB of swapfiles and 14 GB Podman VM are the big levers;
  Xcode DerivedData was already gone).
- The `views` suite (5950 tests) can flake on its default 5 s vitest timeout
  under full turbo parallelism; confirm with
  `cd packages/views && ../../node_modules/.bin/vitest run --testTimeout=30000`.

## Notes & caveats

- pnpm is pinned at 10.28.2; run through corepack with a writable cache:
  `COREPACK_HOME="$(pwd)/.corepack-cache" corepack pnpm install`
- **Demo data**: `bash scripts/seed-demo.sh` (run inside `multica/`) seeds 2 projects,
  5 labels, 12 issues across every board column, and a second member
  (`alex@localhost`, invited then auto-accepted with the dev code). Script is
  idempotent-ish: re-running appends more issues.
- `.env` was created from `.env.example` with `MULTICA_DEV_VERIFICATION_CODE=888888`;
  `JWT_SECRET` stays empty, which is allowed only because APP_ENV is unset (dev default key).
- Migrations: all 563 applied. The Homebrew-Postgres era left the `pg_bigm`
  search indexes unbuilt; after switching to the pgvector+pg_bigm container the
  extension and all six `idx_*_bigm` GIN indexes were created manually (the
  migration hooks only fire for *pending* migrations). Full-text search now uses
  bigram indexes like production. `pg_cron` is still absent (only migration 076
  uses it, guarded); pgvector 0.8.6 is available if anything starts using vectors.
- Rebuild the database image after a base-image bump:
  `podman build -t multica-postgres:pg17-bigm -f docker/pg17-bigm.Containerfile docker`
  then `podman rm -f multica-postgres` and re-run with the same flags (data lives
  in the `multica_pgdata` volume, so it survives).
- Seeded demo data (2 projects, 5 labels, 12 issues, member `alex@localhost`)
  lives in the `multica_pgdata` volume and survived the Homebrew → Podman switch
  via `pg_dump`/`pg_restore`.
