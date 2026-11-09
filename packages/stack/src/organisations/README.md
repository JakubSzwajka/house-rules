# Organisations

Organisations and their members, each holding one role name. One `Organisation` aggregate per organisation, keyed by an `OrgId` the caller picks (with Clerk, the Clerk organisation id). Its state is `Unfounded`, or `Founded` with `name` and `members` (person id to role name). The module reads only one role name, `ADMIN_ROLE` (`"admin"`). Every other name means what the app's `Roles` says.

```ts
class App extends Domain.Model("App", {
  aggregates: [...Organisations.aggregates, Booking],
  views: [...Organisations.views],
}) {}
```

| Command | Permission | Rule |
| --- | --- | --- |
| `CreateOrganisation { name, admin? }` | `organisations:create` | `admin` defaults to the person creating it; a system must name one (`AdminRequired`); an id is never reused (`OrganisationExists`) |
| `AddMember { person, role }` | `organisations:manage` | adding the same member with the same role records nothing; with another role, `AlreadyMember` |
| `ChangeMemberRole { person, role }` | `organisations:manage` | `NotMember` when the person is not a member; the same role records nothing |
| `RemoveMember { person }` | `organisations:manage` | `NotMember` when the person is not a member |

A person managing members must be an admin of that organisation (`NotAdmin`, also for an organisation that does not exist). A system actor holding the permission manages any organisation, so a webhook can sync from the provider; it gets `OrganisationNotFound` for one never created. An agent is checked as itself: it is not a member, so it gets `NotAdmin`, `NotMember` and `NotYourself` like a stranger, and `CreateOrganisation` by an agent needs an explicit `admin` (`AdminRequired`). Demoting or removing the last admin fails with `LastAdmin`, for everyone. Events carry `by` (`authorOf(actor)`).

## Reads

- The members of an organisation: the aggregate's own `read` contract (`api.Organisation.get(orgId)`), not a separate view, since it would copy the state. It needs `organisations:read`, and a person must be a member (`NotMember`).
- A person's organisations: the `PersonOrganisations` view, keyed by `PersonId`, with state `{ organisations: { [orgId]: role } }`. It needs `organisations:read`, and a person reads only their own (`NotYourself`). Names come from the organisation's read.

## Roles from memberships

Clerk puts the person's role in their active organisation into the session token, so with Clerk organisations the provider's `Principal` already carries it: use Clerk for roles and treat this module as the app's copy, synced by a webhook acting as a system.

With a provider that knows only the person (JWT, dev tokens), wrap it:

```ts
SessionLive.pipe(
  Layer.provide(Layer.mergeAll(withMemberships(jwtProvider), Roles.layer(roles))),
  Layer.provideMerge(App.layer(handlers)),
);
```

`withMemberships` reads the `Organisation` named by the principal's `orgId` (the active organisation) and adds the person's role there to `roles`, so `Roles` turns it into permissions. It reads the aggregate, not a view, so a change applies to the next request. Roles in other organisations are not added: a permission held through organisation A must not act in B. Without an `orgId` nothing is added.

## Dropped from party

- People, agents, handles, display names, disabling and standing: the auth provider owns users, and an actor is the provider's subject.
- Custom roles, role scopes and the delegation rule: roles stay static app code in `Roles`, and a member holds one role per organisation, as in Clerk. The "only grant what you hold" check had nothing to guard once roles are not data.
- Generic relationships (`relate`, `isRelated`, kinds of relation): membership was the only one apps used. Other relations belong to the module that owns them.
- Invitations: Clerk sends, expires and accepts them. On its membership webhook, the app sends `AddMember` as a system actor.
- Global admins: a system actor with the permission takes that place.
- Directory reads (`listPeople`, `holdersOf`, `principalsByIds`, `myAccess`, `canAdminOrganisation`) and the permission catalogue: the provider lists users, and `can(actor, permission)` answers access.
- Stores, adapters, migrations, units and locks: one aggregate commits in one transaction, so two admins cannot both leave at once.
