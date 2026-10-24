# @house-rules/party

`PartyOperations.myAccess` reads the caller's own assignments and effective permissions plus the app's public permission catalogue. It needs `party:read`, is read-only and refuses system callers. Bind it with `bindParty` like the other operations. It accepts no target person id. Both stores filter assignments by the caller id before returning them.

Party owns person and agent principals, organisations, relationships, roles and role assignments. Identity owns login bindings. Party stores no email, issuer or login subject.

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

Use `Party.layerMemory(options)` for memory storage. Raw `Party.layer(options)` needs `PersonStore` and `PartyStore`. Share the app's unit adapter and SQL client. Register `@house-rules/party` in `migrations.json`. Migrations `0001` and `0002` create Party's core tables. Append-only `0003` adds invitations. `0004_publish_staff.sql` publishes `party_staff_read(person_id, organisation_id)` over current staff relationships. App read models may use it for SQL privacy filters. Modules still ask Party operations through declared edges, never read this view to make domain decisions.

`PartyOperations.canAdminOrganisation({ organisationId })` needs party:read and returns whether the current person holds party:admin globally or in that scope. It uses live assignments and the catalogue. System callers and unrelated scoped admins get false.

Import PartyMount from main and add `{ ...PartyMount, layer: chosenPartyLayer }` to the app's module plan. Composition captures Party and calls bindParty once. Pass `may: Party.may()`; composition resolves it after modules build. It captures Party and returns a MaySocket with no per-call requirements.

`PermissionCatalogue` belongs to application, not Party. Its service shape is:

```ts
{ permissions: () => Effect<readonly Permission[]> }
```

Composition derives the catalogue from mount descriptors before acquiring Party. Its callback and Runtime.permissions expose the same array. Do not acquire Runtime inside Party's layer. There is no installation callback or mutable reference. Custom-role writes fail closed if the port is absent. Without a catalogue, May returns all held permissions. With it, May intersects them with the current catalogue on every call.

## Operations

Descriptors come from `@house-rules/party/contract`. Only app features are exposed. All operations have empty edges. `T` means transactional, `R` read-only, `D` destructive and `A` needs approval.

| Member | Permission | Flags |
| --- | --- | --- |
| createPerson, createPrincipal | party:create | T |
| disable | party:update | T D A |
| lockActive | party:read | T |
| principalsByIds | party:read | R |
| showPerson | party:read | R |
| showMe | party:read | R |
| myAccess | party:read | R |
| renamePerson | party:update | T |
| createOrganisation | party:create-organisation | T |
| myOrganisations | party:read | R |
| listPeople | party:admin | R |
| listMembers | party:read | R |
| createInvitation | party:admin | T |
| acceptInvitation | party:read | T |
| listInvitations | party:admin | R |
| revokeInvitation | party:admin | T D A |
| showOrganisation | party:read | R |
| canAdminOrganisation | party:read | R |
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

## Principals and standing

`createPrincipal({ id?, displayName, kind, handle, createdBy })` creates a `person` or `agent`. It returns `{ principal, fact }`; the fact is `{ kind: "principal.created", after }`. `createdBy` is an ActorId or null, passed as data by the provisioning process. Party does not infer it from a system caller. Legacy `Person`, `createPerson`, reads and rename retain their existing shapes.

Handle options are app policy:

```ts
Party.layerPostgres({
  builtInRoles,
  handles: {
    pattern: /^[a-z][a-z0-9-]{0,31}$/u,
    reserved: ["me", "none"],
  },
});
```

New handles must contain 1 to 120 characters. Without options there is no additional pattern or reserved word. Pattern and reserved checks are case-sensitive; Party never trims or lowercases handles. Handles are immutable and unique across both kinds, including concurrent creates. Duplicate handles or ids fail with `PersonAlreadyExists`; invalid or reserved handles fail with `PersonInputInvalid`. Migration `0005_principals.sql` backfills existing people with kind `person`, handle equal to id, and null `createdBy`/`disabledAt`. These legacy handles, including those made by `createPerson`, bypass the new handle validation so existing ids and account setup keep working.

Caller rules at the operation boundary:

- `createPrincipal` and `disable` accept only system callers. App provisioning features use explicit `asSystem` edges with reasons. Their permissions are `party:create` and `party:update` respectively.
- `lockActive({ handle, kind })` accepts person and system callers with `party:read`. It needs an open unit and returns the principal. Unknown handles fail with `PersonNotFound`. A kind mismatch also returns `PersonNotFound` for person callers, so they cannot probe handles; system callers get `PrincipalKindRefused`. Disabled principals fail with `PrincipalDisabledRefused`. Asking for kind `agent` rejects a person owner. Party does not know owner roles.
- `principalsByIds({ ids })` accepts person and system callers with `party:read`. It returns matching principals once each, omits missing ids, and includes disabled principals. It exposes no credentials. This supports notification paths as well as person-facing names.
- `standingOf(actorId)` is a facade method for a caller-owned Identity standing slot, not an operation. It returns `active`, `disabled` or `missing`; storage failures remain typed unavailable errors.

`disable({ id })` permanently sets `disabledAt` and returns `{ principal, fact }`. A first disable returns `{ kind: "principal.disabled", before, after }`; a repeated disable preserves the timestamp and returns `fact: null`. Unknown ids fail with `PersonNotFound`. It is transactional, destructive and needs approval. There is no enable. Party permits disabling either kind; protecting an owner is the app's provisioning policy. The composing feature or process chooses which returned facts to record in the same unit. Party never records them itself.

`Party.may()` returns no permissions for a disabled principal. Identity should also check standing before admitting a request. For writes that must not race disable, call `lockActive` in the write's unit. Postgres takes `FOR SHARE`, not `FOR KEY SHARE`, on the principal row until commit or rollback. Disable takes `FOR NO KEY UPDATE` before capturing the change, so it waits for those units; a subsequent lock sees the committed disabled state and fails. Memory's shared `memoryUnitOfWork` serializes whole units and provides the same guarantee. Requests already admitted without `lockActive` may finish after a disable.

Migration `0005` publishes `party_principals_read(id, display_name, kind, handle, created_by, created_at, disabled_at)` and `party_assignments_read(person_id, role_key, organisation_id)`. Read models may select these views for directory ordering and assignment joins. Modules still ask operations, not views, for domain decisions.

## Invitations and membership

`createOrganisation(caller, { id, name })` accepts a person and relates them as staff. The operation gate needs `party:create-organisation`. Bootstrap the creator's scoped admin assignment in the app through an explicit system `assignRole` edge, in the same feature transaction.

`createInvitation(caller, { organisationId, roleKey })` needs an administrator of that organisation. Use `null` to omit a role. The inviter must hold every attached role permission in that scope. Creation returns `{ invitation, code }`. Save the code then: it is never listed again. It has 256 random bits, a seven-day expiry and only its SHA-256 hash is stored.

`acceptInvitation(caller, code)` consumes the code with a conditional write and relates that person as staff. Its result is `{ personId, organisationId, roleKey }`. A feature calls the optional `assignRole` through a system edge. Keep both calls in one transaction, so a failed assignment restores the code and relation. Acceptance rechecks that the inviter can still delegate the current role. Unknown, expired, used and revoked codes all fail with `PartyNotFound`.

`listInvitations(caller, organisationId)` shows only an administered org's invitations, without codes or hashes. `revokeInvitation(caller, id)` checks the invitation's org and needs approval.

`myOrganisations(caller)` returns `{ id, name, relation, roles: [{ roleKey, roleName, permissions }] }[]` for the caller's relationships or scoped assignments. It includes only that person's org-scoped roles, not global roles. An assignment without a relationship has `relation: null`. If several relations exist, `relation` is the first kind in lexical order.

`listPeople(caller)` returns `{ id, displayName, createdAt, assignments, organisations }[]`. Assignments are `{ roleKey, roleName, organisationId, organisationName }`, with null organisation fields for global roles. Organisations are `{ id, name, relation }`. Global admins see everyone and all assignments and relations. Org admins see only staff of their administered orgs and only assignments and relations in those orgs. Global assignments are hidden from org admins, even for a visible person. Other callers get forbidden.

`listMembers(caller, organisationId)` returns `{ id, displayName, createdAt, relation, roles: [{ roleKey, roleName }] }[]` for that org's staff. Roles include only assignments scoped to that org. The operation gate needs `party:read`; Party checks admin authority for the requested org. Members, admins of other orgs and unknown org ids all get `PartyNotFound`.

Both adapters filter storage facts before returning them. Postgres filters people, assignments and relations in SQL; it never fetches another org's assignments for an org-admin list. These reads use the existing tables and need no new migration.

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
