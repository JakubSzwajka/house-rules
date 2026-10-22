# @house-rules/party

## What it does

Party owns persons, organisations, relationships, roles and assignments. It owns their tables and migrations. Identity owns login bindings. Party stores no login credentials.

## Mount and bind

Call `Party.layerMemory({ builtInRoles })` or `Party.layerPostgres({ builtInRoles })`. Each role entry is `{ name, permissions }`, keyed by role key. Raw `Party.layer(options)` needs `PersonStore` and `PartyStore`. Share the app's unit adapter. Postgres also needs the shared SQL client.

Register this package in `migrations.json`. Never edit applied migrations. `0001` owns persons; `0002` adds organisations, relationships, custom roles and assignments. No cross-module foreign keys.

Mount `PermissionCatalogue` before Party. Its `permissions: () => Effect<readonly Permission[], PartyUnavailable>` callback reads `Runtime.permissions` lazily. Acquire Party and `bindParty(service)` first, then Runtime. Only then fill the callback's reference. Custom-role writes fail closed without the port. May filters permissions when the port is present.

Acquire `yield* Party.may()` and pass the resulting MaySocket to composition's app-level `may`. Its `permissionsOf(caller: PersonCaller)` returns an Effect of permissions with no requirements. It captures the built Party service. It does not cache assignments.

## Operations

Use `PartyOperations` from the browser-safe contract door. Bind all descriptors with `bindParty(service)`. App features call them through declared edges. Only features are exposed. All operation edges are empty.

| Operation | Permission | Flags |
| --- | --- | --- |
| createPerson | party:create | transactional |
| showPerson, showMe | party:read | readOnly |
| renamePerson | party:update | transactional |
| createOrganisation, relate, defineRole, assignRole | party:admin | transactional |
| unrelate, revokeRole, deleteRole | party:admin | transactional, destructive, needsApproval |
| showOrganisation, isRelated, listRoles, rolesOf, myAccess | party:read | readOnly |

## Service and fixed rules

- `myAccess` is person-only and takes no target id. It reads only the caller's assignments, effective permissions and the public app catalogue. Postgres filters assignments by that caller id in SQL; memory uses the same port. System callers are refused.
- Person creation is system-only at the binder. Person reads need a person caller. Rename allows only the target person. `erase(id)` is a trusted service hook, not an operation.
- Global admins manage all scopes. An admin whose authority comes only from organisation X may manage roles and assignments only in X. Check both old and new scope when moving a custom role. Only global admins create organisations.
- A person defining or assigning a role must hold every permission it grants in the target scope. Global assignments count in any organisation; another organisation's assignments never count. This covers built-in roles and updates to already assigned custom roles. System assignment is exempt. `party:admin` alone cannot delegate unheld permissions.
- Role reads take a caller. Organisation-scoped callers see global built-ins and custom roles only in their own organisations. Assignment reads apply the same scope filter. Postgres filters these lists in SQL; global admins and trusted system reads see all scopes.
- Built-in keys are reserved. Custom permissions must have `resource:action` syntax and belong to the lazy catalogue. Organisation-scoped custom roles cannot be assigned outside their organisation.
- System callers may assign roles for first sign-in. They cannot revoke roles, define roles or bypass other management checks. Ordinary person callers cannot use the system assignment path.
- May unions every held role across contexts. It drops missing roles and permissions absent from the current catalogue. Revocation takes effect on the next call. MCP and HTTP get the same answer for the same Actor.
- Relationships are directional facts. Management checks every organisation endpoint. Other modules ask `isRelated` through an operation edge; they never query Party tables.
- Domain checks run inside the write unit. All writes require `UnitOfWork.required`. Memory registers undo before mutation; Postgres joins the transaction. Modules never open units.
- Expected errors declare kinds. Unavailable errors have fixed public messages and private diagnostic causes.

The [README](README.md) lists inputs and mounting details. Shared suites test memory and real Postgres. Use `MigrationsTesting.database`, never mocked SQL. Tests use `it.effect` or `it.layer`.
