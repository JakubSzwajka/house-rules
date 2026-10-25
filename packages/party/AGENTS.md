# @house-rules/party

## What it does

Party owns person and agent principals, organisations, relationships, roles and assignments. It owns their tables and migrations. Identity owns login bindings. Party stores no login credentials.

## Mount and bind

Call `Party.layerMemory({ builtInRoles })` or `Party.layerPostgres({ builtInRoles })`. Each role entry is `{ name, permissions }`, keyed by role key. Raw `Party.layer(options)` needs `PersonStore` and `PartyStore`. Share the app's unit adapter. Postgres also needs the shared SQL client.

Register this package in `migrations.json`. Never edit applied migrations. `0001` owns persons; `0002` adds organisations, relationships, custom roles and assignments; `0003` adds hashed one-time invitations; append-only `0004` publishes party_staff_read (person_id, organisation_id), containing current person-to-organisation staff relationships only. Read models may select this view for SQL privacy filters, never the relationship table. No cross-module foreign keys.

Import PermissionCatalogue from application, not Party. Composition supplies its `permissions: () => Effect<readonly Permission[]>` before building modules. It and Runtime.permissions expose the same mount-derived array. Custom-role writes fail closed without the port. May filters permissions when the port is present. Exported PartyMount contains Party, all PartyOperations and bindParty; add the chosen layer in composition/modules.ts.

Declare builtInRoles, systemPermissions and `may = Party.may()` in composition/access.ts. Pass `may` to composition in app.ts and roles to Party's mount in modules.ts. It resolves the MaySocket after Party is built. Its `permissionsOf(caller: PersonCaller)` returns an Effect of permissions with no requirements. It captures the built Party service. It does not cache assignments.

## Operations

Use `PartyOperations` from the browser-safe contract door. Bind all descriptors with `bindParty(service)`. App features call them through declared edges. Only features are exposed. All operation edges are empty.

| Operation | Permission | Flags |
| --- | --- | --- |
| createPerson, createPrincipal | party:create | transactional |
| disable | party:update | transactional, destructive, needsApproval |
| lockActive | party:read | transactional |
| principalsByIds, findPrincipal, holdersOf | party:read | readOnly |
| showPerson, showMe | party:read | readOnly |
| renamePerson | party:update | transactional |
| createOrganisation | party:create-organisation | transactional |
| relate, defineRole, assignRole, createInvitation | party:admin | transactional |
| acceptInvitation | party:read | transactional |
| listInvitations, listPeople | party:admin | readOnly |
| myOrganisations, listMembers | party:read | readOnly |
| revokeInvitation | party:admin | transactional, destructive, needsApproval |
| unrelate, revokeRole, deleteRole | party:admin | transactional, destructive, needsApproval |
| showOrganisation, isRelated, canAdminOrganisation, listRoles, rolesOf, myAccess | party:read | readOnly |

## Service and fixed rules

- `0005_principals.sql` adds principal kind, unique immutable handle, createdBy and disabledAt. It backfills existing people with kind person, handle=id and null provenance/disable time. Legacy handles and `createPerson` bypass the new validation; Person and existing operations keep their old shapes. The migration publishes `party_principals_read(id, display_name, kind, handle, created_by, created_at, disabled_at)` and `party_assignments_read(person_id, role_key, organisation_id)` for app read models.
- `createPrincipal({ id?, displayName, kind, handle, createdBy })` is system-only. Kind is person or agent; createdBy is an ActorId or null passed as data. New handles contain 1 to 120 characters. `handles: { pattern?: RegExp, reserved?: readonly string[] }` supplies app policy. Matching is case-sensitive, with no normalization. Handle uniqueness spans both kinds and concurrent creates.
- `disable({ id })` is system-only, irreversible, transactional, destructive and approval-gated. It returns `{ principal, fact }`, with a `principal.disabled` fact carrying before/after or null when already disabled. Creation returns a `principal.created` fact carrying after. Composition chooses recording in the same unit. Party never emits events. There is no enable. Protecting a person owner is app policy, not a Party role rule.
- `standingOf(actorId)` is a facade method for Identity's caller-owned standing slot, not an operation. It answers active, disabled or missing. May also returns no permissions for disabled principals. New request admission belongs to Identity; already admitted requests without a lock may finish after disable.
- `lockActive({ handle, kind })` accepts person and system callers with party:read and requires a live unit. It returns a principal, or PersonNotFound for unknown handles and kind mismatches for person callers. System callers may receive PrincipalKindRefused for a kind mismatch. Disabled targets return PersonNotFound to person callers and PrincipalDisabledRefused to system callers. Kind agent refuses a person owner. Postgres holds FOR SHARE until unit end, never FOR KEY SHARE. Disable locks FOR NO KEY UPDATE before capturing its fact and waits for active locks. Locks after its commit fail. Memory relies on the shared memoryUnitOfWork's whole-unit serialization.
- `findPrincipal({ handle })` accepts person and system callers with party:read. It returns the full principal by exact handle, including disabledAt for disabled principals, or PersonNotFound. It is a directory read, not an active-principal check.
- `holdersOf({ role, scope? })` accepts person and system callers with party:read. Scope is one organisation id; omitted or null means global assignments only. It returns `{ ids, truncated }` in ascending id order, including disabled holders. Unknown roles and empty scopes return no ids. `holdersLimit` in Party options defaults to 1000 and must be a positive safe integer below Number.MAX_SAFE_INTEGER; invalid options fail acquisition with PartyInputInvalid. Adapters fetch at most limit + 1 distinct ids; Party returns at most limit and flags overflow without failing unavailable. Storage failures remain typed PartyUnavailable. This is an assignment lookup, not a permission grant.
- `principalsByIds({ ids })` accepts both person and system callers with party:read. It returns each matching principal once, includes disabled principals and omits missing ids. This is a directory read, not authority or credential admission.

- `myAccess` is person-only and takes no target id. It reads only the caller's assignments, effective permissions and the public app catalogue. Postgres filters assignments by that caller id in SQL; memory uses the same port. System callers are refused.
- Person creation is system-only at the binder. Person reads need a person caller. Rename allows only the target person. `erase(id)` is a trusted service hook, not an operation.
- Global admins manage all scopes. An admin whose authority comes only from organisation X may manage roles and assignments only in X. Check both old and new scope when moving a custom role. Organisation creation accepts a person with party:create-organisation at the gate and relates the creator as staff. An app feature may bootstrap a scoped admin role through an explicit system assignRole edge.
- A person defining or assigning a role must hold every permission it grants in the target scope. Global assignments count in any organisation; another organisation's assignments never count. This covers built-in roles and updates to already assigned custom roles. System assignment is exempt. `party:admin` alone cannot delegate unheld permissions.
- Role reads take a caller. Organisation-scoped callers see global built-ins and custom roles only in their own organisations. Assignment reads apply the same scope filter. Postgres filters these lists in SQL; global admins and trusted system reads see all scopes.
- Built-in keys are reserved. Custom permissions must have `resource:action` syntax and belong to the mount-derived catalogue. Organisation-scoped custom roles cannot be assigned outside their organisation.
- System callers may assign roles for first sign-in. They cannot revoke roles, define roles or bypass other management checks. Ordinary person callers cannot use the system assignment path.
- May unions every held role across contexts. It drops missing roles and permissions absent from the current catalogue. Revocation takes effect on the next call. MCP and HTTP get the same answer for the same Actor.
- Invitations take `{ organisationId, roleKey: string | null }`. Creation checks the caller administers that org and holds every attached role permission there. It returns `{ invitation, code }` once. Codes use 256 random bits, SHA-256 storage and a seven-day expiry. Lists never return codes or hashes. Acceptance atomically consumes a pending unexpired code, relates the person as staff and returns `{ personId, organisationId, roleKey }`; an app feature assigns the optional role through a system edge in the same unit. Acceptance rechecks the inviter's current delegation authority. Unknown, used, revoked and expired codes are generic not_found. Revocation needs approval.
- `myOrganisations` returns the caller's relationships or scoped assignments as `{ id, name, relation, roles: [{ roleKey, roleName, permissions }] }[]`. Roles are own org-scoped assignments only. Assignment-only membership has null relation; multiple relations use the first kind in lexical order.
- `listPeople` returns `{ id, displayName, createdAt, assignments: [{ roleKey, roleName, organisationId, organisationName }], organisations: [{ id, name, relation }] }[]`. Global admins see all people and assignments. Scoped admins see only staff in administered orgs and only assignments and relations there, never global or other-org assignments. Non-admins get forbidden. Both adapters filter facts before returning; Postgres filters people, assignments and relations in SQL.
- `listMembers({ organisationId })` needs `party:read` at the gate and admin authority in that org inside Party. It returns `{ id, displayName, createdAt, relation, roles: [{ roleKey, roleName }] }[]` for staff, with only org-scoped roles. Members, admins of other orgs and unknown ids get the same not_found. It needs no migration.
- Removing a person's staff relation revokes all assignments scoped to that org in the same unit. Global assignments stay. Removing the last scoped org admin fails with conflict, with a clear message. Postgres locks the organisation before checking, so concurrent removals cannot remove both admins.
- `canAdminOrganisation({ organisationId })` answers whether the current person holds party:admin globally or in that scope, using live assignments and the catalogue. It is a party:read operation, not an admin gate. It returns false for absent authority, including system callers. This lets modules own object checks through declared edges without requiring party:admin for every ordinary booking call.
- Relationships are directional facts. Management checks every organisation endpoint. Other modules ask `isRelated` through an operation edge; they never query Party tables.
- Domain checks run inside the write unit. All writes require `UnitOfWork.required`. Memory registers undo before mutation; Postgres joins the transaction. Modules never open units.
- Expected errors declare kinds. Unavailable errors have fixed public messages and private diagnostic causes.

The [README](README.md) lists inputs and mounting details. Shared suites test memory and real Postgres. Use `MigrationsTesting.database`, never mocked SQL. Tests use `it.effect` or `it.layer`.
