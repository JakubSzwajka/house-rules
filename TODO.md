# TODO

Open work, not alternate law.

## Migration to Alchemy Domain

- [ ] Land the reusable modules in `packages/stack`: comments, notes, contacts, relations, projects, work-items, notifications, delivery, organisations, approval and the Clerk and JWT auth providers. Extend `packages/stack/AGENTS.md` and `README.md` with each module's mount and permissions.
- [ ] Land the booking example (`examples/booking/packages/domain`, `examples/booking/apps/server`) and its README, then drop the two placeholder tests.
- [ ] Decide what the site says about the new model beyond the rules page, with the owner.
- [ ] Release `@house-rules/stack` 0.1.0 through the publish workflow after the owner's yes. Confirm the `NPM_TOKEN` owner can create the new package name.
- [ ] Decide whether to deprecate the retired packages on npm. That needs separate approval.

## Rules

- [ ] Decide which `@house-rules/rules` checks still apply to Alchemy apps. The feature, read-model, way, migration and SQL rules describe the retired kits; other apps still consume them, so they stay until those apps move.
- [ ] Consider lint rules for the new block rules: `requirePermission` first in a guarded `decide`, `Forbidden` in `rejects`, no `Date.now()` or `Clock` in a model, kebab-case kind-suffixed file names.

## Decisions still open

- [ ] Map OAuth token scopes to permissions when a real app needs it: the app role's permissions intersected with token scopes.
- [ ] Prove human approval across the MCP clients and deployment shapes we use. Agents cannot approve their own writes.
- [ ] Design accounts: login linking, password reset, email verification and sign-in rate limiting.

## App-driven work

- [ ] Move Trippy onto `@house-rules/stack` and Alchemy Domain.
- [ ] Add modules only from real needs: invites, tags, quotas, usage, files, preferences or entitlements.
