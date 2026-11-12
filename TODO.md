# TODO

Open work, not alternate law.

## Migration to Alchemy Domain

- [x] Land the reusable modules: delivery and the Clerk and JWT auth providers in `packages/stack`; comments, notes, contacts, relations, projects, work-items, notifications and organisations as copyable modules in `examples/modules`.
- [ ] 3in1 copies the modules it uses (Comments, Contacts, Notes, Notifications, Organisations, Projects, Relations, WorkItems) into its own domain package, keeping event tags and fields, before it takes a stack release without them.
- [ ] Land the booking example (`examples/booking/packages/domain`, `examples/booking/apps/server`) and its README, then drop the two placeholder tests.
- [ ] Decide what the site says about the new model beyond the rules page, with the owner.
- [x] Release `@house-rules/stack` 0.1.0 through the publish workflow.
- [x] Release `@house-rules/stack` 0.2.0 without the domain modules, which moved to `examples/modules`.
- [x] Release `@house-rules/stack` 0.2.1: Clerk signs out tokens without `exp`, or without `azp` when `authorizedParties` is set.
- [ ] Release `@house-rules/stack` 0.2.2: `jwt()` signs out tokens without `exp`.
- [ ] Deprecate `@house-rules/stack` 0.1.0 and 0.2.0 on npm. The owner runs it.
- [ ] Decide whether to deprecate the retired packages on npm. That needs separate approval.

## Postgres platform spike

- [ ] Run more than one replica per schema: one outbox loop per model (advisory lock or `SKIP LOCKED`), schedules claimed once, and `LISTEN`/`NOTIFY` so live reads see other replicas' commits.
- [ ] Host projections, streams and sagas, and backfill views added to a database that already has events.
- [ ] Ask Alchemy whether a Node or Postgres platform is planned, with the owner's yes; delete `packages/domain-postgres` when it ships.

## Found by the trippy spike (2026-11-08)

- [ ] Alchemy: a view's `events` judges only events that match `where`, so a private view leaks through filters (see `packages/stack/AGENTS.md`). Report upstream with the owner's yes; until then consider a stack helper that refuses `list`/`events` for private views.
- [ ] Alchemy: a view's `computed` never reaches a read; nothing outside `View.ts` reads it. Report upstream.
- [ ] Alchemy: a view routes an event to one key or a fixed set of named routes, so one event cannot fan out to a variable set of keys (every share of a trip). Apps record one event per key instead.
- [ ] Stack: `Principal` and `Person` carry no email. An app that shares by verified email needs its own middleware before `Session`.
- [ ] Stack: `clerk()` has no `audience` or required-scope option, and MCP as an OAuth resource server is not built (`packages/stack/src/auth/README.md`). trippy's MCP needs both.
- [ ] domain-postgres: `platformForTests` and `PgForTests` read only `DATABASE_URL` and fall back to the house-rules database; an app whose `DATABASE_URL` is its dev database needs a way to name a test database. `PgForTests` is one Layer value, so building it twice in one process shares the first pool.
- [ ] domain-postgres: receipts match on command id only, so a resend with a changed payload returns the first receipt silently.
- [ ] Rules: `comment-discipline` treats a whole `Domain.Aggregate({...})` or `Domain.View({...})` definition as a class header and refuses a one-line why inside `decide`, which `AGENTS.md` allows.
- [ ] Rules 0.20.1 drops the app-layer import rules, `use-case-is-capability` and the migrations check. An app mid-move keeps old code without them; say so in the release notes.

## Rules

- [ ] Release `@house-rules/rules` with the retired-kit checks removed (feature, read-model, way, migration and SQL rules, `configs.features` renamed to `configs.workspace`). Apps on 0.20.1 keep the old checks until they upgrade.
- [ ] Consider lint rules for the new block rules: `requirePermission` first in a guarded `decide`, `Forbidden` in `rejects`, no `Date.now()` or `Clock` in a model, kebab-case kind-suffixed file names.

## Decisions still open

- [ ] Map OAuth token scopes to permissions when a real app needs it: the app role's permissions intersected with token scopes.
- [ ] Design accounts: login linking, password reset, email verification and sign-in rate limiting.

## App-driven work

- [ ] Move Trippy onto `@house-rules/stack` and Alchemy Domain.
- [ ] Add modules only from real needs: invites, tags, quotas, usage, files, preferences or entitlements.
