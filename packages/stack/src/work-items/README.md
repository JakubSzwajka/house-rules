# Work items

Work items with a workflow the app configures, a priority, a due date, one holder and one level of children. Bodies are plain text; an app may render them as markdown.

## Compose

```ts
class App extends Domain.Model("App", {
  aggregates: [...WorkItems.aggregates],
  views: [...WorkItems.views],
  policies: [...WorkItems.policies],
}) {}

const Host = App.layer(WorkItems.handlers);
const Middleware = Layer.mergeAll(SessionLive, WorkItems.workflowConfig(WorkItems.board));
```

`workflowConfig(workflow)` serves the `WorkflowConfig` middleware, which gives `CurrentWorkflow` to the commands that move status. It fails the Layer build on a workflow that repeats a state name, names an unknown state, or claims into a closed state.

## Workflow

A workflow is data: `states` with a category (open, active, done or cancelled), the `initial` state, `transitions` from each state to a list of states or `"any"`, the `claim` state and the `release` move `{ from, to }`. A state with no entry in `transitions` allows no move. `decide` checks every status change, claim and release against it; anything else fails `TransitionNotAllowed { from, to }`. The `board` preset has todo, doing, blocked, done and dropped, any move between them, claim into doing and release from doing to todo.

Entering a closed category (done or cancelled) stamps `closedAt` with the command's time, also between cancelled and done. A move inside the same closed category keeps it; reopening clears it. A move to the current status records nothing.

## Holders

`ClaimWorkItem` makes the caller the holder and moves the item to the claim state. A closed item fails `WorkItemClosed`, an item someone else holds fails `WorkItemHeld { holder }`, and a repeat claim records nothing. A holder is a party: a person or an agent, by its `PartyId`. An agent claims, holds and releases as itself, so `HeldWorkItems("agent:claude")` lists what the agent holds, and its person cannot release it without `work_items:assign`. A system actor's claim fails `Forbidden`.

`ReleaseWorkItem` clears the holder and moves the item from `release.from` to `release.to`. The holder may release; anyone else needs `work_items:assign`, or fails `NotHolder { holder }`. An unheld item outside `release.from` records nothing. `AssignWorkItem { holder }` sets or clears any holder, a person or an agent, and needs `work_items:assign`. Neither assign nor release changes status, except release's own move.

## Priority and due date

`priority` is `null` or one of `low`, `medium`, `high` and `urgent` (`WorkItemPriority`). `due` is `null` or a calendar day as `YYYY-MM-DD` (`WorkItemDue`); a day that does not exist, such as `2026-02-30`, fails the schema. Both are optional on `CreateWorkItem` and default to `null`. On `EditWorkItem` a missing key keeps the value and `null` clears it. `WorkItemCreated` and `WorkItemEdited` carry both, and events or state stored before the fields existed decode with `null`. The module does not sort or alert on them; apps do.

## Hierarchy

A parent is set once, at creation, and a child is one level deep: a parent must be a root. That rule spans two records, so it runs as reserve then commit:

1. `CreateWorkItem { parent }` records `WorkItemCreated` with the parent pending and no container.
2. `ParentAdoption` sends `AdoptChild` to the parent. A missing parent fails `WorkItemNotFound`; a parent that has a parent, pending or confirmed, fails `TooDeep`. Otherwise the parent records `WorkItemChildAdopted { child, container }`.
3. The policy then sends `ConfirmParent`, and the child records `WorkItemParentConfirmed` with the parent's container. On a refusal it sends `RefuseParent`, and the child records `WorkItemParentRefused { reason }` and stays a root in the inbox.

Since a parent must already exist and be a root, and an item with a parent cannot adopt, no chain is deeper than one level and no cycle can form, an item naming itself included.

## Commands

| Command | Records | Rejects (besides `Forbidden`) | Permission |
| --- | --- | --- | --- |
| CreateWorkItem `{ title, body?, container?, parent?, priority?, due? }` | WorkItemCreated | WorkItemExists | write |
| EditWorkItem `{ title?, body?, priority?, due? }` | WorkItemEdited | WorkItemNotFound | write |
| ChangeWorkItemStatus `{ status }` | WorkItemStatusChanged | WorkItemNotFound, TransitionNotAllowed | write |
| AssignWorkItem `{ holder }` | WorkItemAssigned | WorkItemNotFound | assign |
| ClaimWorkItem | WorkItemClaimed | WorkItemNotFound, WorkItemClosed, WorkItemHeld, TransitionNotAllowed | write |
| ReleaseWorkItem | WorkItemReleased | WorkItemNotFound, NotHolder, TransitionNotAllowed | write |
| AdoptChild `{ child }` | WorkItemChildAdopted | WorkItemNotFound, TooDeep | link |
| ConfirmParent, RefuseParent | WorkItemParentConfirmed, WorkItemParentRefused | none | link |

Permissions are `work_items:read`, `work_items:write`, `work_items:assign` and `work_items:link`; only the policy's system actor `hierarchyKeeper` holds `link`. Titles are trimmed, 1 to 200 characters; bodies up to 20,000. A container is any string id, such as a project id; none means the inbox. An unchanged edit records nothing. Changes record `by` and `for`, the person an agent acted for (else `null`). A due date is exactly `YYYY-MM-DD`, ten characters, and a real calendar day.

## Views

Each needs `work_items:read`.

- `WorkItemCard`, keyed by the work item: its whole state.
- `ContainerWorkItems`, keyed by container: every item in it, by id, children included once confirmed. Clients build the tree from `parent`.
- `HeldWorkItems`, keyed by person: the items they hold, by id.

An item with no container (the inbox) is in no `ContainerWorkItems` key; read it by id.

`ContainerWorkItems` and `HeldWorkItems` fold `WorkItemCard`, not the aggregate, so their checkpoints count `WorkItemCard/<id>`, never `WorkItem/<id>`. In beta.85 a read `atLeast` a command's receipt never matches them and fails `ConsistencyTimeout` after 10 seconds, which a test sees as a hang. Read the card `atLeast` the receipt, then the chained view `atLeast` the card's cursor:

```ts
const claimed = yield* api.ClaimWorkItem(id);
const card = yield* api.WorkItemCard.snapshot(id, { atLeast: claimed });
const held = yield* api.HeldWorkItems.get(me, {
  atLeast: { stream: `WorkItemCard/${id}`, version: card.cursor },
});
```

## Left out

- Moving an item or a subtree between parents or containers. It needs the same adopt flow plus children following their parent, by a policy.
- Import, lifecycle hooks (`removeContainer`, `releaseHolder`) and system reads. A system reads views or `client.state`; the other two are policies reacting to the app's events.
- Configurable title and body limits, holder kinds, container kinds and depth. The id schemas are static, holders are parties, and one level is what a parent's own state can prove.
- Paging and tree size limits: views hold their whole key.
- Free JSON attributes and a holder at creation: apps keep their own data by item id, and assign after creating.
- The access port. Apps scope who sees which container with their own views or `validate`.
