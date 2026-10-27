# @house-rules/work-items

Work items with a host-configured workflow, a single holder and a parent column. Bodies are plain text. A host may render them as markdown.

## Mount

```ts
const options = {
  ...WorkItems.presets.board,
  idStrategy: "sequence", // Omit for default random hexadecimal ids.
  containerKinds: ["project"],
  holderKinds: ["person"],
  claim: { toState: "doing", holderKind: "person" },
};
const module = WorkItems.layerPostgres(options).pipe(Layer.provide(accessLayer));
```

Composition provides SqlClient and a SQL unit adapter, then mounts `WorkItemsMount` with this module layer. Memory uses `WorkItems.layerMemory(options)` and `memoryUnitOfWork`. Register the package in the host's migrations list. See [AGENTS.md](AGENTS.md) for ports and fixed rules.

## Workflow

The board preset has todo/open, doing/active, blocked/active, done/done and dropped/cancelled. It allows any transition between these states. Claim moves to doing; release moves doing to todo. Roots have depth zero and the preset permits one child level.

Set `transitions` to a map from state to allowed target names or `"any"`. An omitted source has no allowed transitions. Unknown targets and disallowed transitions fail `TransitionNotAllowed`. The same rules apply to claim when status changes and to the configured release transition. Claim needs no self-transition when the item is already in claim.toState. Claim's target must be open or active.

Entering a closed category sets closedAt to now, including a change between cancelled and done. Moving between states in the same closed category keeps closedAt; reopening clears it. Closing again starts a new interval. Assignment changes only the holder. Claim accepts unheld items and items held by `{claim.holderKind, actor.id}`. Another holder causes WorkItemHeld. Concurrent claims by different actors have one winner. A claim by the current holder already in claim.toState is a no-op with no events. A write-authorized actor may release any holder; an unheld item outside release.from is also a no-op with no events.

## Data and access

`WorkItem` has id, title, body, status, nullable holder, parent and container, attributes, createdAt, updatedAt and nullable closedAt. Timestamps are epoch milliseconds. References are `{ kind, id }`. Attributes accept any JSON value, including null, arrays and scalars. The module stores them as jsonb and does not filter on their contents.

`WorkItemAccess` is host-owned behavior supplied through a module-owned port:

- `access(actor, containerOrNull)` returns `"write"`, `"read"` or `"none"`.
- `visibleContainers(actor)` returns `{ containers: refs, inbox: boolean }`.

The host maps expected port errors to `WorkItemAccessUnavailable`. Unavailable messages are fixed and hide their cause. Denied person reads and writes fail `WorkItemNotFound`, as do missing items and stored items whose container kind is no longer configured. Lists exclude unconfigured container kinds and filter visibility in SQL before sorting or limiting. An explicit filter for a retired container kind fails `WorkItemNotFound`. The host must keep the two access answers consistent.

## Operations and events

`WorkItemsOperations` exposes create, edit, move, import, setStatus, assign, claim, release, get, getForSystem, list and tree. Person reads require `work_items:read`; person writes require `work_items:write` and are transactional. Import is a system-only transactional write requiring `work_items:import`. Edit is destructive. These person operations keep refusing system callers with `WorkItemNotFound`.

The get, getForSystem, list and tree declarations keep all metadata inline so read-model edge lint can prove their read-only graphs through the public contract, in workspace source and installed packages. This changes no descriptor values or runtime behavior.

`getForSystem({ id })` is a separate read-only operation for event reactions and schedules. It requires `WorkItemPermissions.systemRead` (`work_items:system-read`) and accepts only system callers. A person is refused with `WorkItemsCallerDenied` (kind forbidden), even when they hold the permission. It returns the stored item without an actor or either access-port check, including items in retired container kinds, or `WorkItemNotFound` when the id is missing. Composition must explicitly grant the system permission. Both the error and permission are exported from the contract and main doors. The trusted facade method is `WorkItems.getForSystem(id)`; caller checks live in its operation binding.

Create accepts title and optional body, attributes, holder, parent and container. Defaults are empty body, empty object attributes, no holder, no parent and inbox. A child takes its parent's container regardless of the supplied container. Edit accepts id and a patch of title, body or attributes. Use `move({ id, to })` to change place. `to` is `{ parent: id }` or `{ container: refOrNull }`; the latter makes the item a root. Every descendant follows to the target container, keeping its id and parent link. Move checks write access on the old and new place, configured container kinds, cycles and maxDepth for the whole subtree. It checks maxTreeSize only when the container changes, so reparenting inside an oversized container remains allowed, consistent with create. It is person-only and transactional. Notes, relations and history remain attached to the same ids.

`idStrategy` accepts `"random"` or `"sequence"` on every layer path. Omitting it preserves random hexadecimal ids. Sequence ids are increasing integer strings, backed by a persistent Postgres sequence or a memory counter. Gaps after failed transactions are allowed.

`import({ items })` requires `work_items:import` and a system caller. Its trusted facade method is `WorkItems.import(items)`. It accepts full WorkItem records and preserves ids, timestamps, status, holder, content and parent links. Parents must exist in storage or the batch, in any order. Content, configured states/kinds, cycles, depth and target size are validated before insertion. Import requires createdAt <= updatedAt and a non-null closedAt exactly when the status category is done or cancelled. When set, closedAt must satisfy createdAt <= closedAt <= updatedAt. Existing ids or duplicates in the batch fail conflict `WorkItemIdTaken`; persons fail forbidden `WorkItemsCallerDenied`. The result is `{ items, events }` with one Created fact per item. Imports advance the counter in either id mode, so switching from random to sequence cannot collide with imported numeric ids. In sequence mode numeric imports must be below 9223372036854775807; random mode also accepts numeric ids outside that range, which the bigint sequence cannot generate. Both import and move join the open unit; memory registers undo before mutation.

Postgres locks only the involved containers with transaction-level advisory locks, ordered by lock key before taking item row locks. Create joins its destination container lock; move locks the source and target and reads only those containers; import locks and reads its batch's containers and referenced parents. Moves reread their subtree under row locks to preserve concurrent edits. Holder deletion discovers all involved containers, takes the same ordered container locks, then locks matching rows in id order before clearing them. Ordinary edits, assignment and status changes keep single-item row locks. Unrelated containers do not wait for each other's transactions. If a parent or moved item changes containers during lock discovery, or holder rows appear in an undiscovered container, the operation returns conflict `WorkItemsChanged` (409, "Work items changed; try again") and the caller can retry the whole unit. Only create, move and import declare WorkItemsChanged in their operation failure schemas; the facade-only releaseHolder keeps its typed conflict. Sequence allocation uses nextval, with a short session advisory lock around nextval/setval to keep advancement monotonic. That lock is released before the SQL call returns, not at commit, and never locks the work_items table. Only import and getForSystem declare WorkItemsCallerDenied, not the shared failure union.

List accepts optional container, inbox, state, category, holder, parent, size and cursor. Explicit null container selects inbox, null holder selects unheld items and null parent selects roots. Omitted filters match all visible items. Filters combine with AND. Pages are oldest first by createdAt and id, capped by maxPageSize. Pass the returned `next` as cursor; it is exclusive. Tree takes a nullable container and returns `{ item, children }` roots with descendants up to maxDepth. The positive integer maxTreeSize bounds the entire container, including children, and defaults to 500 in the board preset. Tree fetches maxTreeSize + 1 rows and fails `WorkItemTreeTooLarge` with kind invalid and fixed message "Work item tree is too large." on overflow. It never returns a truncated tree.

Single-item writes return `{ item, events }`; import returns `{ items, events }` with one Created fact per item. `WorkItemEvents` exports Created, Edited, Moved, StatusChanged, Assigned, Claimed and Released schemas. Moved carries old and new `{ parent, container }` values. Facts carry kind and subject; change events carry from/to values. Single-item writes return one fact, except the claim and release no-ops described above, which return the unchanged item with `events: []`. The feature decides whether to record it and supplies the envelope through its event-log edge. This module never emits.

`removeContainer(ref)` deletes all that container's items. `releaseHolder(ref)` clears that holder everywhere without changing status. These trusted lifecycle hooks are facade methods, not operations. Both require the caller's live unit and return no events. A concurrent assign can give the holder to a row after releaseHolder rereads its matching rows. Assignment takes no container lock, so that row can keep the holder even when releaseHolder succeeds. Hosts must prevent new assignments to a holder during deletion; releaseHolder alone does not guarantee this. Migration 0002 makes the parent foreign key deferred until commit so imports can insert children before parents in id order. Domain code still validates parent links before writing; deletion cascades remain immediate. The module publishes `work_items_view` for host read models.
