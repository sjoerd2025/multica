#!/usr/bin/env bash
# Seed the local Multica dev workspace with demo data via the real HTTP API.
#
# Usage:  bash scripts/seed-demo.sh
# Prereq: backend on :8080 with MULTICA_DEV_VERIFICATION_CODE=888888 in .env.
# Idempotent-ish: re-running appends more demo issues (titles are unique per run).
set -euo pipefail

API="${API:-http://localhost:8080}"
EMAIL="${EMAIL:-dev@localhost}"
CODE="${CODE:-888888}"
SLUG="${SLUG:-dev-workspace}"
INVITEE="${INVITEE:-alex@localhost}"

say() { printf '\033[36m==>\033[0m %s\n' "$1"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------- session ----
# verify-code sets the multica_auth cookie; reuse the cookie jar for all calls.
say "Logging in as $EMAIL"
# A verification row must exist for the email before verify-code will accept
# even the dev code (GetLatestVerificationCode), so send one first. In dev mode
# the fixed MULTICA_DEV_VERIFICATION_CODE from .env is accepted.
curl -sf -c /tmp/multica-seed.cookies -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\"}" \
  "$API/auth/send-code" > /dev/null
curl -sf -c /tmp/multica-seed.cookies -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}" \
  "$API/auth/verify-code" > /tmp/multica-seed.login.json
ok "logged in"

AUTH=(-b /tmp/multica-seed.cookies -H "X-Workspace-Slug: $SLUG" -H 'Content-Type: application/json')

# CSRF: cookie-authenticated writes must echo the readable multica_csrf_session
# cookie value in the X-CSRF-Token header (preferred session binding; the
# token-bound multica_csrf cookie is the fallback). The client does exactly
# this — see ApiClient.readCsrfValue in packages/core/api/client.ts.
CSRF=$(awk '$6=="multica_csrf_session" || $6=="multica_csrf" {print $7}' /tmp/multica-seed.cookies | head -1)
if [ -z "$CSRF" ]; then
  echo "no CSRF cookie found after login" >&2
  exit 1
fi
AUTH+=(-H "X-CSRF-Token: $CSRF")

# ---------------------------------------------------------------- members ----
say "Inviting second member ($INVITEE)"
# There is no /api/workspaces/by-slug route; resolve the id from the list.
WS_ID=$(curl -sf "${AUTH[@]}" "$API/api/workspaces" | jq -r --arg slug "$SLUG" '.[] | select(.slug == $slug) | .id' | head -1)
if [ -z "$WS_ID" ]; then
  echo "workspace '$SLUG' not found (list it at $API/api/workspaces)" >&2
  exit 1
fi
INV_HTTP=$(curl -s -o /tmp/multica-seed.invite.json -w '%{http_code}' "${AUTH[@]}" \
  -d "{\"email\":\"$INVITEE\",\"role\":\"member\"}" \
  "$API/api/workspaces/$WS_ID/members")
if [ "$INV_HTTP" = "200" ] || [ "$INV_HTTP" = "201" ]; then
  ok "invitation created for $INVITEE — accepting it now (dev code)"
  # Log in as the invitee (account is created on the fly in dev mode) and
  # accept every pending invitation, so the workspace really has 2 members.
  curl -sf -c /tmp/multica-seed-invitee.cookies -H 'Content-Type: application/json' \
    -d "{\"email\":\"$INVITEE\"}" "$API/auth/send-code" > /dev/null
  curl -sf -c /tmp/multica-seed-invitee.cookies -H 'Content-Type: application/json' \
    -d "{\"email\":\"$INVITEE\",\"code\":\"$CODE\"}" "$API/auth/verify-code" > /dev/null
  CSRF_I=$(awk '$6=="multica_csrf_session" || $6=="multica_csrf" {print $7}' /tmp/multica-seed-invitee.cookies | head -1)
  for id in $(curl -sf -b /tmp/multica-seed-invitee.cookies "$API/api/invitations" | jq -r '.[]? | select(.status == "pending") | .id'); do
    curl -sf -b /tmp/multica-seed-invitee.cookies -H "X-CSRF-Token: $CSRF_I" \
      -X POST "$API/api/invitations/$id/accept" > /dev/null && ok "$INVITEE accepted invitation $id"
  done
else
  cat /tmp/multica-seed.invite.json >&2
  echo "invite failed with HTTP $INV_HTTP" >&2
  exit 1
fi

# ---------------------------------------------------------------- projects ---
say "Creating projects"
p1=$(curl -sf "${AUTH[@]}" -d '{"title":"Website Relaunch","description":"New marketing site: redesign, content migration, and launch checklist.","icon":"rocket","status":"in_progress","priority":"high"}' \
  "$API/api/projects")
p2=$(curl -sf "${AUTH[@]}" -d '{"title":"Agent Platform","description":"Agent runtime, daemon, and skills work.","icon":"bot","status":"planned","priority":"medium"}' \
  "$API/api/projects")
P1=$(jq -r .id <<<"$p1"); P2=$(jq -r .id <<<"$p2")
ok "Website Relaunch ($P1)"
ok "Agent Platform ($P2)"

# ---------------------------------------------------------------- labels -----
say "Creating labels"
mklabel() { curl -sf "${AUTH[@]}" -d "{\"name\":\"$1\",\"color\":\"$2\",\"description\":\"$3\"}" "$API/api/labels" | jq -r .id; }
L_BUG=$(mklabel bug '#ef4444' 'Something is broken')
L_FEAT=$(mklabel feature '#3b82f6' 'New capability')
L_DESIGN=$(mklabel design '#a855f7' 'UI and UX work')
L_INFRA=$(mklabel infra '#f59e0b' 'Build, deploy, monitoring')
L_DOCS=$(mklabel docs '#10b981' 'Documentation')
ok "bug=$L_BUG feature=$L_FEAT design=$L_DESIGN infra=$L_INFRA docs=$L_DOCS"

# ---------------------------------------------------------------- issues -----
say "Creating issues across all columns"
issue() { # issue <status> <priority> <project|-> <labels-comma|-> <title> <description>
  local body
  body=$(jq -n --arg s "$1" --arg p "$2" \
              --arg pr "$3" --arg ls "$4" --arg t "$5" --arg d "$6" '
    {title:$t, description:$d, status:$s, priority:$p}
    + (if $pr != "-" then {project_id:$pr} else {} end)
    + (if $ls != "-" then {label_ids:($ls | split(","))} else {} end)')
  curl -sf "${AUTH[@]}" -d "$body" "$API/api/issues" | jq -r '"\(.identifier // .number // "ok") \(.title // .error // "")"'
}

issue todo      urgent  "$P1" "$L_DESIGN,$L_FEAT" "Redesign the pricing page" \
  "New pricing tiers with a comparison table. Copy from marketing doc, follow the new design tokens."
issue todo      high    "$P1" "$L_FEAT" "Add testimonials carousel to homepage" \
  "Pull quotes from case studies, auto-rotate with pause on hover, lazy-load images."
issue backlog   medium  "$P1" "$L_FEAT" "Blog RSS feed" \
  "Emit RSS 2.0 at /feed.xml from the posts collection; validate with the W3C feed validator."
issue backlog   low     "$P2" "$L_DOCS" "Write daemon quickstart guide" \
  "Cover install, login, runtime registration, and the three commands every agent needs."
issue in_progress high    "$P1" "$L_BUG" "Mobile nav menu does not close on route change" \
  "Steps: open menu on iPhone Safari, tap any link, observe the overlay stays. Fix the click-outside handler."
issue in_progress urgent  "$P2" "$L_INFRA" "Set up CI pipeline for e2e tests" \
  "Run the Playwright suite on every PR. Gate merges on flake-free runs; add retry budget."
issue in_progress medium  "$P2" "$L_FEAT" "Skills versioning UI" \
  "Show version history on the skill detail page with diff preview and one-click rollback."
issue in_review high    "$P1" "$L_DESIGN" "Dark mode color audit" \
  "Check every page against the contrast matrix; fix the 6 flagged components."
issue in_review medium  "-"  "$L_DOCS" "API reference: authentication section" \
  "Document cookie sessions vs personal access tokens with curl examples."
issue blocked   high    "$P2" "$L_INFRA,$L_BUG" "Daemon reconnect storms after network blips" \
  "Blocked on reproducing locally — needs the runtime reconnect grace period from MUL-####."
issue done      medium  "$P1" "$L_FEAT" "Add OpenGraph images for shared links" \
  "Generated per-page OG images deployed with the site. Shipped with the relaunch branch."
issue done      low     "-"  "$L_DOCS" "Update README screenshots" \
  "Replaced stale screenshots with 0.6.0 UI captures."
ok "12 issues created (2 todo, 2 backlog, 3 in_progress, 2 in_review, 1 blocked, 2 done)"

say "Seed complete. Open http://localhost:3000/$SLUG/issues"
