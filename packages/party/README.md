# @house-rules/party

`PartyOperations.myAccess` reads the caller's own assignments and effective permissions plus the app's public permission catalogue. It needs `party:read`, is read-only and refuses system callers. Bind it with `bindParty` like the other operations. It accepts no target person id. Both stores filter assignments by the caller id before returning them.

Party owns persons, organisations, relationships, roles and role assignments. Identity owns login bindings. Party stores no email, issuer or login subject.

## Mount

```ts
const options = {
  builtInRoles: {
    member: { name: "Member", permissions: ["party:read"] },
    admin: { name: "Administrator", permissions: ["party:admin", "party:read"] },
  },
};
const partyLayer = Party.layerPostgres(options).pipe(
  Layer.provide(database),
  Layer.provide(catalogueLayer),
);
```

Use `Party.layerMemory(options)` for memory storage. Raw `Party.layer(options)` needs `PersonStore` and `PartyStore`. Share the app's unit adapter and SQL client. Register `@house-rules/party` in `migrations.json`. Migrations `0001` and `0002` create Party's core tables. Append-only `0003` adds invitations.

Acquire Party, pass the service to `bindParty(service)`, then acquire Runtime with those bindings. Plug `yield* Party.may()` into composition's app-level `may`. It captures Party and returns a MaySocket with no per-call requirements.

`PermissionCatalogue` is a port with this shape:

```ts
{ permissions: () => Effect<readonly Permission[], PartyUnavailable> }
```

Mount its layer before acquiring Party. Its callback reads `Runtime.permissions` lazily, after Runtime acquisition. Do not acquire Runtime inside Party's layer. A callback backed by a reference can fail with `PartyUnavailable` until Runtime is ready. No callback runs during Party acquisition. Custom-role writes fail closed if the port is absent. Without a catalogue, May returns all held permissions. With it, May intersects them with the current catalogue on every call.

## Operations

Descriptors come from `@house-rules/party/contract`. Only app features are exposed. All operations have empty edges. `T` means transactional, `R` read-only, `D` destructive and `A` needs approval.

| Member | Permission | Flags |
| --- | --- | --- |
| createPerson | party:create | T |
| showPerson | party:read | R |
| showMe | party:read | R |
| renamePerson | party:update | T |
| createOrganisation | party:create-organisation | T |
| myOrganisations | party:read | R |
| listPeople | party:admin | R |
| createInvitation | party:admin | T |
| acceptInvitation | party:read | T |
| listInvitations | party:admin | R |
| revokeInvitation | party:admin | T D A |
| showOrganisation | party:read | R |
| relate | party:admin | T |
| unrelate | party:admin | T D A |
| isRelated | party:read | R |
| defineRole | party:admin | T |
| deleteRole | party:admin | T D A |
| listRoles | party:read | R |
| assignRole | party:admin | T |
| revokeRole | party:admin | T D A |
| rolesOf | party:read | R |

Organisation creation takes `{ id, name }`. Relationships take `{ from: { kind, id }, to: { kind, id }, kind }`; endpoint kinds are `person` or `organisation`. Roles take `{ key, name, permissions, organisationId }`. Assignments take `{ personId, roleKey, organisationId }`. Use `null` for global scope. Role reads add `builtIn`.

## Invitations and membership

`createOrganisation(caller, { id, name })` accepts a person and relates them as staff. The operation gate needs `party:create-organisation`. Bootstrap the creator's scoped admin assignment in the app through an explicit system `assignRole` edge, in the same feature transaction.

`createInvitation(caller, { organisationId, roleKey })` needs an administrator of that organisation. Use `null` to omit a role. The inviter must hold every attached role permission in that scope. Creation returns `{ invitation, code }`. Save the code then: it is never listed again. It has 256 random bits, a seven-day expiry and only its SHA-256 hash is stored.

`acceptInvitation(caller, code)` consumes the code with a conditional write and relates that person as staff. Its result is `{ personId, organisationId, roleKey }`. A feature calls the optional `assignRole` through a system edge. Keep both calls in one transaction, so a failed assignment restores the code and relation. Acceptance rechecks that the inviter can still delegate the current role. Unknown, expired, used and revoked codes all fail with `PartyNotFound`.

`listInvitations(caller, organisationId)` shows only an administered org's invitations, without codes or hashes. `revokeInvitation(caller, id)` checks the invitation's org and needs approval.

`myOrganisations(caller)` returns only the person's organisations, selected through staff relationships or scoped assignments. `listPeople(caller)` shows everyone to global admins, and only staff of administered organisations to org admins. Other callers are refused. Postgres filters both lists in SQL.

`unrelate` on person-to-organisation staff also revokes that person's assignments scoped to that org. Global roles stay. It refuses removal of the last scoped org admin with `PartyLastAdmin`, kind conflict, and locks the organisation before checking on Postgres.

## Fixed rules

Built-in roles live in options. Custom roles live in `party_role`. Custom keys cannot replace built-in keys. Permissions must be valid `resource:action` strings from the catalogue. A custom role may belong to one organisation or be global. Only global admins may edit global roles. Editing a role's scope checks both its old and new scope. Defining or assigning a role also requires every granted permission in that scope, including built-in roles and updates to assigned custom roles. Global permissions count in an organisation, never the reverse. Permissions in another organisation do not count. `party:admin` alone grants no extra delegation rights.

Assignments refer to a role key, not a role row. This lets them resolve built-in roles too. An organisation admin may manage assignments only in that organisation. Organisation-scoped custom roles cannot be assigned elsewhere. Global admins may manage every organisation. Trusted system callers may assign a default role during first sign-in. Ordinary persons cannot use that exception. System callers cannot revoke roles or manage custom roles. Their trusted assignment path is exempt from the delegation subset check.

`listRoles(caller)` returns global built-ins plus custom roles in the caller's organisations. `rolesOf(caller, personId)` filters assignments to those same scopes and hides global custom roles from scoped callers. Global admins and trusted system reads see all scopes. Both stores filter lists before returning them; Postgres does so in SQL.

May unions permissions from all assignments, across all contexts. It ignores removed roles and stale permissions. It caches nothing, so revocation affects the next call. HTTP and MCP callers with the same Actor get the same permissions. Domain operations still check management scope inside the write unit. Relationship checks are directional facts; they grant no authority on their own.

Any person may read a person's display name. Only that person may rename it. Person creation is system-only at the operation boundary. `party.erase(id)` is trusted service code for account deletion, not an exposed operation.

Every write requires an open unit. Memory registers rollback before mutation. Postgres joins the app's transaction. Party never opens a unit. Tables have no cross-module foreign keys. Errors declare kinds; unavailable messages are fixed and keep diagnostic causes private.

## Tests

Run `pnpm exec tsc --project tsconfig.json --noEmit` and `pnpm exec varlock run --path ../../ -- vitest run` from this package. Shared storage and domain suites run on memory and real Postgres through `MigrationsTesting.database`.
