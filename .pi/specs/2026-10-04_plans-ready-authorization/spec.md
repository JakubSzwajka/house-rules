# Plans-ready authorization

Follows `2026-10-04_authorization-framework` (done, shipped as capability 0.4.0 and Trippy v0.12.0). Agreed with the owner on 2026-10-04. Built while the owner was away (AFK), so the smaller choices below were made by the orchestrator and are marked **(AFK choice)**.

Trippy will get a paid plan later. Nothing is billed yet and there are no users to grandfather. This round makes every seam ready, with trivial cartridges, so the paid plan later only swaps cartridges.

## Product rule (Trippy)

- Creating a Trip is paid. Collaborators are free: a Share may read and edit a Trip whatever their own plan is. The owner pays.
- When an owner stops paying, their Trips **freeze**. A frozen Trip can be read, deleted and unshared. It can't be edited or shared further, by the owner or by a Share.
- A plan may cap how many Trips a user owns.

## Model

```
step 2 Grant           caller's plan  -> permissions        (framework slot; app builds grantFor(viewer))
step 4 module policy   relation ∩ trip state -> permissions (framework policy shape; module data)
quota                  plan -> limit number; module counts and checks inside the create transaction
```

One billing cartridge will later fill three slots: `Grant` (framework), `OwnerStanding` and `PlanLimits` (ports the Trips module owns). Today each gets a trivial cartridge: the member grant, everyone active, no limit.

## Decisions

1. V1. `definePolicy` gains an object-state dimension. A policy with states answers `allows(relation, state, permission)`: true only when both the relation and the state allow the permission. `table()` covers relation × state × permission. The relation-only policy from 0.4.0 keeps working unchanged (non-breaking, capability 0.5.0).
2. V2. Trippy splits `trips:create` from `trips:write`. `create_trip` needs `trips:create`; that is the permission a plan gates. `trips:write` stays free for Shares.
3. V3. Trippy splits `trips:unshare` from `trips:share`, so a frozen owner can revoke access but not grant it. Listing a Trip's Shares needs `trips:unshare` ("manage existing access"), so a frozen owner can still see who has access. **(AFK choice; rejected: one `trips:share` for both, which can't express "frozen may unshare, not share".)**
4. V4. Trip states: `active` = all permissions; `frozen` = read, delete, unshare. Relations: owner = read, write, delete, share, unshare; shared = read, write.
5. V5. `OwnerStanding` is a port in `@trippy/trips`: a batch lookup from owner ids to `active | lapsed`, so `list_trips` makes one call. Lapsed owner means frozen Trip. Default cartridge: everyone active. The Trips layer captures it at construction, so service methods keep no requirements.
6. V6. `PlanLimits` is a port in `@trippy/trips`: the most Trips an actor may own, or no limit. Default cartridge: no limit. `create` takes a transaction-scoped advisory lock keyed by the owner, counts owned Trips, then inserts, in one transaction, so two creates at once can't both pass. Over the limit fails with a typed `TripLimitReached({ limit })`. **(AFK choice on the lock; rejected: counting in `grantFor`, which races and ties app billing to module data.)**
7. V7. `TripActionRefused` gains `reason: "relation" | "frozen"`, so web and MCP can say "the owner's plan has lapsed" instead of a bare refusal. **(AFK choice.)**
8. V8. The app gets `grantFor(viewer)`, which returns the member set (now with `trips:create`) for everyone. It is the seam a plan lookup will fill. The web and MCP adapters call it where they provide `memberGrant` today. **(AFK choice: build the seam now; rejected: keep the constant until billing exists.)**

## Acceptance

1. house-rules: `pnpm check` and `pnpm test` exit 0. Tests: relation-only policy unchanged; stateful policy allows only the intersection; the table covers every relation × state × permission; the literal types hold. The README "Permissions and approval" section explains plans: Grant from plan, object state in the policy, quotas in the module.
2. Trippy: `pnpm test` exits 0; check minus `pins` exits 0 (local `file:` link to house-rules, as in v1's preview). Tests, against the real Trips service:
   - a lapsed owner's frozen Trip: the owner can read, delete, unshare and list Shares, and is refused (`reason: "frozen"`) on edit and share; a Share can read and is refused on edit;
   - the Trip still appears in lists for both;
   - with a limit of 1, a second create fails with `TripLimitReached`, and two creates at once leave exactly one Trip;
   - a caller whose Grant lacks `trips:create` gets `Forbidden` on `create_trip` and no Trip is written;
   - MCP and web map `TripLimitReached` and the frozen refusal to clear responses.

## Non-goals

- Billing: Clerk Billing or Stripe, webhooks, a subscriptions table, real plan lookup in `grantFor`.
- The "upgrade" response wording beyond the typed errors above.
- Token scope narrowing, CallWatch, CLI, any push, PR or release.

## Open

1. Plan source: Clerk Billing (`has({ feature })`) or our own billing module fed by Stripe webhooks.
2. Where the plan → permissions and plan → limits tables live: app server code, or a small `plans` package.
3. Grace period: does `lapsed` start at the first failed payment or after a grace window? A billing-module concern; Trips only sees `active | lapsed`.
