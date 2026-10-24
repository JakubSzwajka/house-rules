# @house-rules/work-items

Work items with a host-configured workflow, a single holder and a parent column. Bodies are plain text. A host may render them as markdown.

## Mount

```ts
const options = {
  ...WorkItems.presets.board,
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

Entering a closed category sets closedAt. Moving between closed states retains the start of that closed interval; reopening clears it. Assignment changes only the holder. Claim accepts unheld items and items held by `{claim.holderKind, actor.id}`. Another holder causes WorkItemHeld. Concurrent claims by different actors have one winner. A claim by the current holder already in claim.toState is a no-op with no events. A write-authorized actor may release any holder; an unheld item outside release.from is also a no-op with no events.

## Data and access

`WorkItem` has id, title, body, status, nullable holder, parent and container, attributes, createdAt, updatedAt and nullable closedAt. Timestamps are epoch milliseconds. References are `{ kind, id }`. Attributes accept any JSON value, including null, arrays and scalars. The module stores them as jsonb and does not filter on their contents.

`WorkItemAccess` is host-owned behavior supplied through a module-owned port:

- `access(actor, containerOrNull)` returns `"write"`, `"read"` or `"none"`.
- `visibleContainers(actor)` returns `{ containers: refs, inbox: boolean }`.

The host maps expected port errors to `WorkItemAccessUnavailable`. Unavailable messages are fixed and hide their cause. Denied reads and writes fail `WorkItemNotFound`, as do missing items and stored items whose container kind is no longer configured. Lists filter visibility in SQL before sorting or limiting. The host must keep the two access answers consistent.

## Operations and events

`WorkItemsOperations` exposes create, edit, setStatus, assign, claim, release, get, list and tree. Reads require `work_items:read`; writes require `work_items:write` and are transactional. Edit is destructive. System callers fail not_found because operations require an explicit person actor.

Create accepts title and optional body, attributes, holder, parent and container. Defaults are empty body, empty object attributes, no holder, no parent and inbox. A child takes its parent's container regardless of the supplied container. Edit accepts id and a patch of title, body or attributes. Parent and container are immutable.

List accepts optional container, inbox, state, category, holder, parent, size and cursor. Explicit null container selects inbox, null holder selects unheld items and null parent selects roots. Omitted filters match all visible items. Filters combine with AND. Pages are oldest first by createdAt and id, capped by maxPageSize. Pass the returned `next` as cursor; it is exclusive. Tree takes a nullable container and returns `{ item, children }` roots with descendants up to maxDepth. The positive integer maxTreeSize bounds the entire container, including children, and defaults to 500 in the board preset. Tree fetches maxTreeSize + 1 rows and fails `WorkItemTreeTooLarge` with kind invalid and fixed message "Work item tree is too large." on overflow. It never returns a truncated tree.

Writes return `{ item, events }`. `WorkItemEvents` exports Created, Edited, StatusChanged, Assigned, Claimed and Released schemas. Facts carry kind and subject; change events carry from/to values. Writes return one fact, except the claim and release no-ops described above, which return the unchanged item with `events: []`. The feature decides whether to record it and supplies the envelope through its event-log edge. This module never emits.

`removeContainer(ref)` deletes all that container's items. `releaseHolder(ref)` clears that holder everywhere without changing status. These trusted lifecycle hooks are facade methods, not operations. Both require the caller's live unit and return no events. The module publishes `work_items_view` for host read models.
