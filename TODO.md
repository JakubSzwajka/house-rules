# TODO

Open work, not alternate law. Decisions 25 to 29 keep all domain modules in packages and app nodes in features. Read models stay in the app; ways import contracts, not module values.

## Decisions still open

- [ ] People preset is open, not designed. Use one config over Identity and Party, choosing a source per capability. Keep Identity and Party separate.
- [ ] Map OAuth token scopes to permissions when a real app needs it. The result must be the app role's permissions intersected with token scopes. Decide where app roles live.
- [ ] Prove human approval across the MCP clients and deployment shapes we use, including CLI confirmation. Agents cannot approve their own writes.

## Framework work

- [ ] Release the ten public packages through .github/workflows/publish.yml after the owner's yes. They are 0.x and unreleased since the v2 breaking changes in decision 24.
- [ ] Fix the known Party Postgres setup-hook flake in people.test.ts under full-suite load. Keep the 10s timeout for now, as the owner chose.
- [ ] Add a multi-process schedule lease before running more than one instance. There is no lease yet, so items must be idempotent.

- [ ] Add a migration plan command, `house-rules-migrations plan --from <sha> --to <sha>`. Compare migration ids and hashes for the listed modules. Report pending, edited and removed files; edited or removed applied SQL must block release. Use the deployed commit, not the last tag. A byte-identical move must not appear pending. Startup evidence must still catch database drift.
- [ ] Decide audit retention and implement deletion through CallAudit, never app-owned SQL over its table. Add a true `before` cursor to row reads.
- [ ] Shield calls from a broken CallWatch. A watch must preserve the work's exit, but its type cannot prove that. Keep driver details out of failure logs.
- [ ] Design audit reads for people and admins, with explicit access rules and A/B tests. A read-only MCP entry could answer "what did my agent do?"
- [ ] Add an events outbox inside the entry unit. Dispatch through scheduled system entries, one unit per item, with retries and duplicate handling. Do not add a production loop that opens its own units.
- [ ] Add other protocols through the router when a real app needs them. Apps must not build raw Effect tools, RPCs or HTTP endpoints themselves.
- [ ] Consider a SELECT-only database role granted only published views. The current checker uses a bounded SQL grammar; it does not enforce database grants or analyse procedural SQL semantics.
- [ ] Decide whether unmatched API paths should return a JSON `not_found` rather than an empty 404.

## App-driven work

- [ ] Move Trippy from the retired capability package and Viewer to the kits, Actor and CurrentActor.
- [ ] Design accounts: explicit login linking, password reset, email verification and sign-in rate limiting. Identity never merges people by email. Provider redirect/callback flows, account recovery and token revocation need their own design.
- [ ] Pick one authority for organisations and memberships. Membership must not grant object access by itself; module policy still decides.
- [ ] Add modules only from real needs: invites, tags, quotas, usage, files, preferences or entitlements. Provider adapters ship apart from domain packages.
- [ ] Prove browser session renewal and revocation before a real app relies on them. A cleared cookie does not revoke a copied token. The booking reference has a web page and account UI.
- [ ] Follow [the booking proof map](examples/booking/TESTS.md) for current gaps. Do not carry forward the removed example's web-page claims.
- [ ] Rebuild `staticFiles` after replacing build output. It lists files once at construction; a running handler does not serve new or replaced files. Improve dev tooling if an app needs live rebuilds.

## History

The old proposal for app-local folder modules was replaced by decisions 25 and 26. All domain modules are packages. Only the entry runtime opens a production unit. The old rule against calls between app actions was replaced by declared node edges and feature-cycle checks.
