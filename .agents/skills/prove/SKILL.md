---
name: prove
description: Start an isolated booking HTTP/MCP fixture on loopback and capture real protocol responses.
---

# Booking proof

Kind: repo-local. Run from the task worktree only. Save evidence outside git under `~/.pi/agent/proof/house-rules-stack/<branch>/`. Read `docs/tasks/289/MANUAL_TESTING.md` for acceptance steps.

## What this starts

`examples/booking/apps/api/scripts/prove-host.ts` uses the existing `createApp`, `modulePlan`, web/MCP ways, first-sign-in hook, schedule and Node Host. The Host selects a free loopback port. Storage is memory, including real rollback, Party roles and audit. No fake Who, fixed May, direct service seed, new route or extra tool is installed.

The fixture explicitly creates an `AuthJwtLocal` test signer and configures `Identity.oidc` with its public JWKS. The signer fixes this resource's audience at acquisition and signs temporary Alice/Bob bearer credentials. Normal Identity signature/audience checks, first-sign-in and Party.may still run. Credentials stay in a private `credentials.json` outside git. Never display, attach or commit that file. The helper reads it without logging headers. `run.json` contains only the URL and PID.

This proves runtime HTTP/MCP behavior, not production OAuth integration or browser/password sign-in. Memory MyBookings intentionally returns 503 unavailable. Do not claim a successful SQL query or use invented memory rows. Keep the production MCP catalogue unchanged: only show_booking and my_bookings. The ten migrated queries are HTTP-only, except due_payments on the schedule. Prove migrated my_profile/list_roles and wrong-person list_members over HTTP, then existing show_booking over MCP as a query-pipeline regression, not as a migrated MCP exposure.

## Start

Use one shell for startup, requests and cleanup so `$PROVE_PID` identifies only this fixture. No Postgres, secret store, live server or environment file is needed.

```bash
export PATH=/home/kuba/.local/share/mise/installs/node/24.21.0/bin:$PATH
node --version # v24.21.0
pnpm --version # 12.5.1
APP=examples/booking/apps/api
PROOF="$HOME/.pi/agent/proof/house-rules-stack/$(git branch --show-current)"
mkdir -p "$PROOF"
export RUN=$(mktemp -d "$PROOF/booking-run-XXXXXX")
# The app's src-only tsconfig does not cover scripts. Check the fixture explicitly.
pnpm --filter @example/api run typecheck:prove
pnpm --filter @example/api exec esbuild scripts/prove-host.ts --bundle --platform=node --format=esm --external:effect '--external:@effect/*' --outfile=dist/prove-host.js
NODE_ENV=test node "$APP/dist/prove-host.js" "$RUN" > "$RUN/host.log" 2>&1 &
export PROVE_PID=$!
trap 'kill -TERM "$PROVE_PID" 2>/dev/null; wait "$PROVE_PID"' EXIT
# Stop waiting on either failure or readiness, never wait for success alone.
timeout 20 bash -c 'until test -s "$RUN/run.json"; do kill -0 "$PROVE_PID" 2>/dev/null || exit 1; sleep 0.2; done'
```

The proof directory must already exist outside the worktree. The fixture resolves symlinks before checking that boundary and writes credential files exclusively. If startup fails, inspect `host.log`, stop only that PID and report CANNOT PROVE. Do not replace authentication or change app configuration to make a request pass.

## Walk the flow

The helper prints status, public request metadata and response body, never credentials. Save each command's output under `$RUN` with `tee`; keep the source acceptance vocabulary. There is no test runner here. All requests cross the actual listener.

```bash
node "$APP/scripts/prove.mjs" http "$RUN" none my_profile '{}' | tee "$RUN/http-no-auth.txt"
node "$APP/scripts/prove.mjs" http "$RUN" alice my_profile '{}' | tee "$RUN/http-alice-profile.txt"
node "$APP/scripts/prove.mjs" http "$RUN" bob my_profile '{}' | tee "$RUN/http-bob-profile.txt"
node "$APP/scripts/prove.mjs" http "$RUN" alice list_roles '{}' | tee "$RUN/http-roles.txt"
node "$APP/scripts/prove.mjs" http "$RUN" alice recent_audit '{}' | tee "$RUN/http-admin-refusal.txt"
node "$APP/scripts/prove.mjs" http "$RUN" alice create_organisation '{"id":"proof-private-org","name":"Alice private proof org"}' | tee "$RUN/http-create-org.txt"
node "$APP/scripts/prove.mjs" http "$RUN" alice list_members '{"organisationId":"proof-private-org"}' | tee "$RUN/http-owner-members.txt"
node "$APP/scripts/prove.mjs" http "$RUN" bob list_members '{"organisationId":"proof-private-org"}' | tee "$RUN/http-foreign-members.txt"
node "$APP/scripts/prove.mjs" http "$RUN" alice make_booking '{"id":"proof-booking","guestName":"Alice proof guest","paymentId":"proof-payment","amount":100}' | tee "$RUN/http-command.txt"
node "$APP/scripts/prove.mjs" http "$RUN" alice show_booking '{"id":"proof-booking"}' | tee "$RUN/http-owner.txt"
node "$APP/scripts/prove.mjs" http "$RUN" bob show_booking '{"id":"proof-booking"}' | tee "$RUN/http-foreign.txt"
node "$APP/scripts/prove.mjs" mcp "$RUN" alice --list | tee "$RUN/mcp-tools.txt"
node "$APP/scripts/prove.mjs" mcp "$RUN" alice show_booking '{"id":"proof-booking"}' | tee "$RUN/mcp-owner.txt"
node "$APP/scripts/prove.mjs" mcp "$RUN" bob show_booking '{"id":"proof-booking"}' | tee "$RUN/mcp-foreign.txt"
node "$APP/scripts/prove.mjs" mcp "$RUN" none show_booking '{"id":"proof-booking"}' | tee "$RUN/mcp-no-auth.txt"
node "$APP/scripts/prove.mjs" mcp "$RUN" alice my_bookings '{}' | tee "$RUN/mcp-no-database.txt"
pnpm --filter @example/api run map -- --diff --text | tee "$RUN/map-diff.txt"
```

Expected: no-auth 401, profiles 200 with different person IDs and own roles, list_roles 200, recent_audit 403. Alice's create_organisation and list_members return 200; Bob's list_members returns HTTP 404 with public code not_found, without Alice's person or organisation data. This exercises a migrated query's wrong-person gate without extra grants. Booking command/owner return 200, foreign HTTP 404. MCP lists exactly two read-only tools. Its owner result has structured booking data; foreign result has `isError: true` without the guest data. Missing bearer is 401 with resource metadata challenge. Memory my_bookings is an error result with unavailable, not an empty successful list. Map diff says no changes. Inspect plan/map for 17 feature entries and 12 read-model entries; projections remain separate.

Do not print Authorization/Cookie headers or copy credentials into evidence. Do not enable write MCP tools, grant admin, test a live issuer, or send traffic beyond this loopback fixture. No UI is served; browser screenshots are outside this fixture's proof.

## Stop

```bash
kill -TERM "$PROVE_PID"
wait "$PROVE_PID"
trap - EXIT
# This must fail to connect after shutdown.
node "$APP/scripts/prove.mjs" http "$RUN" none my_profile '{}'
```

Record the refusal to connect and Host exit code. Leave private runtime state outside git; do not attach `credentials.json`. No database or source cleanup is required. Delete evidence only with approval naming its exact paths.
