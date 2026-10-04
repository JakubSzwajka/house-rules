# Authorization in the capability framework

House-rules adds authorization to `@house-rules/capability`. Trippy is the first app to use it and the test bed. Agreed with the owner on 2026-10-04.

## Needs

1. N1. An agent can never do more than its user. (True today: modules check the `Actor`.)
2. N2. A caller can be narrowed below its user: a read-only token, a CLI that may only list, a paid plan without a feature.
3. N3. A human confirms risky calls, so a confused or prompt-injected agent can't act alone.
4. N4. Rules about one object (owner vs Share) stay in the module, next to its data.
5. N5. The same rules hold on every surface: web, MCP, a future CLI, tests.
6. N6. The types force the wiring. You can't forget to provide a gate, and gate failures show in the error type.
7. N7. Access is testable as a who × action table.
8. N8. "Not yours" still looks like "not found". No existence leaks.

## Model

Four questions, in order, for every call:

```
1 WHO          Viewer / Actor       adapter builds it            exists
2 MAY AT ALL   Grant (permission)   framework slot, per request  new
3 HUMAN OK     Approval             framework slot, per surface  new (rat-stack shape)
4 MAY ON THIS  module policy        module, own data             exists, gets a permission vocabulary
```

- **Permission:** a `resource:action` string, such as `trips:delete`. The module that owns the resource names its permissions.
- **App role:** a fact about the caller with no object, such as member, admin, or a paid plan. It feeds Grant. A quota ("max 5 trips") is not a permission. It needs a count, so it lives in a module.
- **Relation (resource role):** how the caller stands to one object, such as owner or shared of Trip 7. The module maps each relation to permissions and checks it against its own data.
- **Grant:** "does this caller hold permission P at all?" Caller permissions = permissions of the app role ∩ token scopes. It fails with `Forbidden`. It runs before any data is read, so it can't leak existence.
- **Approval:** "does the human mean it, right now?" It is consent, not permission. Elicitation is how the MCP surface fills it. The agent must never be able to answer its own approval.

## Decisions

1. D1. Permissions are named `resource:action` strings, not capability names. Several capabilities share one.
2. D2. A contract carries three separate things: `annotations` (what it does: `readOnly`, `destructive`, hints for clients), `permission` (who may), and `needsApproval` (ask a human).
3. D3. `permission` is required on every contract. A capability any caller may run says `permission: "public"`, on purpose. The type enforces the field, so no lint rule is needed.
4. D4. `implement` runs Grant, then Approval, then the handler. A contract with a non-public permission adds `Grant` to the requirements and `Forbidden` to the failures. `needsApproval: true` adds `Approval` and `ApprovalDenied`. Surfaces (`toTool`) see the gate errors in the failure schema.
5. D5. `Grant` and `Approval` are `Context.Service` slots in `@house-rules/capability`, with `allowAll` and `denyAll` cartridges. Grant also gets a cartridge built from a permission list. The adapter provides both per request, the way it provides `Viewer`.
6. D6. MCP approval uses `McpServer.elicit` from `effect/unstable/ai`: a yes/no form showing the capability name and its input as data. Declined, cancelled, or a client without elicitation support all fail closed with `ApprovalDenied`.
7. D7. The framework offers a small policy shape for relations (relation → permissions, `allows(relation, permission)`) and a pure who × action table for tests. The module owns its lists and still checks its own data (Trippy keeps its SQL `reaches`).
8. D8. CONTEXT.md's line "Access and permission checks stay inside the service, and a contract only carries the flags" is rewritten. A contract declares its permission. Checks of one object stay in the module.

## Trippy application (preview, local, uncommitted)

- Permissions in `@trippy/trips`: `trips:read`, `trips:write`, `trips:delete`, `trips:share`.
- Relations: owner gets all four. Shared gets read and write (today's behavior).
- App role: every signed-in user is a member and holds all four. The web session Grant and the MCP token Grant both use the member set (scope narrowing is deferred, see Open).
- Approval: web provides `allowAll` (the click is the yes). MCP provides the elicitation cartridge.
- `needsApproval: true` on `remove_trip`, `share_trip` and `unshare_trip`. The owner gave a yes by name on 2026-10-04 to put these three in the MCP catalogue for the local preview. Shipping them still needs a release decision.
- Wiring: Trippy points `@house-rules/capability` at the local house-rules checkout with a `file:` path, temporarily. `pnpm run pins` fails until house-rules is committed, pushed and re-pinned to a SHA.

## Acceptance

1. house-rules: `pnpm check` and `pnpm test` exit 0. Tests cover: Grant pass and `Forbidden`; Approval allow and deny; order (Grant before Approval, Approval before handler); a `"public"` contract needs no Grant; types reject a contract without `permission`; `toTool` failure schema carries gate errors; the elicitation cartridge's accept, decline, and unsupported-client paths; the policy table.
2. Trippy: `pnpm test` exits 0. `pnpm check` minus `pins` exits 0. New MCP tests: each of the three new tools with a fake Viewer; user B can't remove or share user A's Trip (not found); a shared user gets refused on remove and share; approval declined means nothing changes.

## Non-goals (this round)

- `CallWatch` audit hook (its own TODO item; the order will be `CallWatch.around(Grant → Approval → handler)`).
- CLI, HTTP, RPC projections and the `--yes` flag.
- Token scope narrowing and custom Clerk scopes.
- A web confirm dialog, and two-step approval through the web.
- Commit, push, re-pinning Trippy, any release.

## Status

- 2026-10-04: house-rules capability 0.4.0 built. Verifier (other model family) failed it once: a malformed approval answer escaped as a defect instead of `ApprovalDenied`. Fixed and re-verified: PASS, 0 blocking.
- 2026-10-04: Trippy preview built. Verifier failed it once: read, write and list bypassed `tripPolicy`, and a test helper threw inside Effect code. Fixed: the policy now decides every Trip operation, and `NotTripOwner` became `TripActionRefused({ tripId, permission })`. Re-verified: PASS, 0 blocking.
- 2026-10-04: the owner approved shipping `remove_trip`, `share_trip` and `unshare_trip` to the production MCP catalogue behind approval. Both repos land through a branch and a PR. Trippy re-pins from `file:` to the merged house-rules SHA before its release.
- 2026-10-04: shipped. house-rules #12 (merge `4d4c9f9`, capability 0.4.0). Trippy #23 (merge `48960fd`), released as Trippy v0.12.0, `fx release verify` 5 of 5.
- 2026-10-04: the owner tested approval on prod from a real MCP client. The approval form appeared, "no" left the Trip in place, and "yes" removed it. Open 2 is answered for that client. Claude.ai and ChatGPT are still untested.
- 2026-10-04: spec closed as done. The Open items below carry over to the house-rules and Trippy `TODO.md`, or to a later "authz v2: Grant from caller" spec.

## Open

1. Scope narrowing: map token scopes to permissions once Clerk issues custom `trips:*` scopes.
2. Elicitation works on Trippy prod (one replica) from the client the owner tested. Still to check: Claude.ai and ChatGPT.
3. Should `remove_item` need approval too?
4. How do two-step approval and the web confirm fit, if elicitation turns out to be unreliable?
5. Where do app roles live once there is more than one module: app server code, or a small roles package?
6. Relation resolver port: the relation lookup (Trippy's `tripAccess` plus the `reaches` SQL fragment in every statement) could sit behind one module port with two questions, `relationOf(actor, object)` and `objectsFor(actor)`. A Party archetype could then fill it later as a cartridge, without changing the policy.
7. Grant is one fixed member set in Trippy today. Once plans or scopes arrive, it becomes `grantFor(viewer)` (∩ token scopes on MCP), built where it is provided now.
