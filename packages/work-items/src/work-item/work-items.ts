import { type Actor, UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import type { WorkItemStore } from "../storage.js";
import { type WorkItemAccess, WorkItemVisibility, configuredVisibility } from "./access.js";
import type { WorkItemEvent, WorkItemMutation } from "./events.js";
import type { WorkItemsOptions } from "./options.js";
import { sameRef } from "./order.js";
import { workItemTree } from "./tree.js";
import { readStoredWorkItem } from "./system-read.js";
import {
  DepthExceeded,
  TransitionNotAllowed,
  type WorkItem,
  WorkItemAccessUnavailable,
  WorkItemClosed,
  WorkItemCreate,
  WorkItemEdit,
  WorkItemFilters,
  WorkItemHeld,
  WorkItemInputInvalid,
  WorkItemNotFound,
  type WorkItemRef,
  WorkItemTreeTooLarge,
} from "./work-item.js";
const invalid = () => new WorkItemInputInvalid({ message: "Invalid work item input." });
const now = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
const subject = (item: WorkItem) => ({ kind: "work_item" as const, id: item.id });
const content = ({ title, body, attributes }: WorkItem) => ({ title, body, attributes });
const holding = ({ holder, status }: WorkItem) => ({ holder, status });
const result = (item: WorkItem, event: WorkItemEvent): WorkItemMutation => ({
  item,
  events: [event],
});
export const makeWorkItems = (
  store: WorkItemStore["Service"],
  access: WorkItemAccess["Service"],
  options: WorkItemsOptions,
) => {
  const decodeContainer = Schema.decodeEffect(
    Schema.NullOr(
      Schema.Struct({ kind: Schema.Literals(options.containerKinds), id: Schema.NonEmptyString }),
    ),
  );
  const decodeHolder = Schema.decodeEffect(
    Schema.NullOr(
      Schema.Struct({ kind: Schema.Literals(options.holderKinds), id: Schema.NonEmptyString }),
    ),
  );
  const decodeContent = Schema.decodeEffect(
    Schema.Struct({
      title: Schema.NonEmptyString.check(Schema.isMaxLength(options.maxTitleLength)),
      body: Schema.String.check(Schema.isMaxLength(options.maxBodyLength)),
      attributes: Schema.Json,
    }),
  );
  const visible = Effect.fn("WorkItems.visible")(function* (actor: Actor) {
    return yield* access.visibleContainers(actor).pipe(
      Effect.flatMap(Schema.decodeEffect(WorkItemVisibility)),
      Effect.map((visibility) => configuredVisibility(visibility, options.containerKinds)),
      Effect.mapError((cause) => new WorkItemAccessUnavailable({ cause })),
    );
  });
  const requireAccess = Effect.fn("WorkItems.requireAccess")(function* (
    actor: Actor,
    container: WorkItemRef | null,
    write: boolean,
    existing = false,
  ) {
    const ref = yield* decodeContainer(container).pipe(
      Effect.mapError(() => (existing ? new WorkItemNotFound() : invalid())),
    );
    const level = yield* access.access(actor, ref).pipe(
      Effect.flatMap(Schema.decodeEffect(Schema.Literals(["write", "read", "none"]))),
      Effect.mapError((cause) => new WorkItemAccessUnavailable({ cause })),
    );
    if (level === "none" || (write && level !== "write")) return yield* new WorkItemNotFound();
  });
  const writable = Effect.fn("WorkItems.writable")(function* (actor: Actor, id: string) {
    yield* UnitOfWork.required;
    const item = yield* store.lock(id);
    if (item === null) return yield* new WorkItemNotFound();
    yield* requireAccess(actor, item.container, true, true);
    return item;
  });
  const closed = (status: string) =>
    options.states.some(
      (state) =>
        state.name === status && (state.category === "done" || state.category === "cancelled"),
    );
  const move = Effect.fn("WorkItems.move")(function* (item: WorkItem, status: string) {
    const allowed = options.transitions[item.status];
    if (
      !options.states.some((state) => state.name === status) ||
      (allowed !== "any" && !allowed?.includes(status))
    )
      return yield* new TransitionNotAllowed({ from: item.status, to: status });
    const updatedAt = yield* now;
    return {
      ...item,
      status,
      updatedAt,
      closedAt: closed(status) ? (item.closedAt ?? updatedAt) : null,
    };
  });
  return {
    get: Effect.fn("WorkItems.get")(function* (actor: Actor, id: string) {
      const item = yield* readStoredWorkItem(store, id);
      yield* requireAccess(actor, item.container, false, true);
      return item;
    }),
    getForSystem: (id: string) => readStoredWorkItem(store, id),
    create: Effect.fn("WorkItems.create")(function* (actor: Actor, input: WorkItemCreate) {
      yield* UnitOfWork.required;
      const decoded = yield* Schema.decodeEffect(WorkItemCreate)(input).pipe(
        Effect.mapError(invalid),
      );
      let container = decoded.container ?? null;
      if (decoded.parent != null) {
        const parent = yield* writable(actor, decoded.parent);
        container = parent.container;
        let ancestor: WorkItem | null = parent;
        let depth = 1;
        while (ancestor.parent !== null) {
          if (depth > options.maxDepth) return yield* new DepthExceeded();
          ancestor = yield* store.get(ancestor.parent);
          if (ancestor === null) return yield* new WorkItemNotFound();
          depth++;
        }
        if (depth > options.maxDepth) return yield* new DepthExceeded();
      }
      yield* requireAccess(actor, container, true);
      const holder = yield* decodeHolder(decoded.holder ?? null).pipe(Effect.mapError(invalid));
      const fields = yield* decodeContent({
        title: decoded.title,
        body: decoded.body ?? "",
        attributes: decoded.attributes === undefined ? {} : decoded.attributes,
      }).pipe(Effect.mapError(invalid));
      const createdAt = yield* now;
      const item: WorkItem = {
        ...fields,
        id: yield* Effect.all(
          Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
        ).pipe(
          Effect.map((words) => words.map((word) => word.toString(16).padStart(8, "0")).join("")),
        ),
        container,
        holder,
        parent: decoded.parent ?? null,
        status: options.initial,
        createdAt,
        updatedAt: createdAt,
        closedAt: closed(options.initial) ? createdAt : null,
      };
      yield* store.insert(item);
      return result(item, { kind: "work_items.created", subject: subject(item), item });
    }),
    edit: Effect.fn("WorkItems.edit")(function* (actor: Actor, id: string, patch: WorkItemEdit) {
      const before = yield* writable(actor, id);
      const decoded = yield* Schema.decodeEffect(WorkItemEdit)(patch).pipe(
        Effect.mapError(invalid),
      );
      const fields = yield* decodeContent({ ...content(before), ...decoded }).pipe(
        Effect.mapError(invalid),
      );
      const item = { ...before, ...fields, updatedAt: yield* now };
      yield* store.save(item);
      return result(item, {
        kind: "work_items.edited",
        subject: subject(item),
        from: content(before),
        to: content(item),
      });
    }),
    setStatus: Effect.fn("WorkItems.setStatus")(function* (
      actor: Actor,
      id: string,
      status: string,
    ) {
      const before = yield* writable(actor, id);
      const item = yield* move(before, status);
      yield* store.save(item);
      return result(item, {
        kind: "work_items.status_changed",
        subject: subject(item),
        from: before.status,
        to: item.status,
      });
    }),
    assign: Effect.fn("WorkItems.assign")(function* (
      actor: Actor,
      id: string,
      holder: WorkItemRef | null,
    ) {
      const before = yield* writable(actor, id);
      const decoded = yield* decodeHolder(holder).pipe(Effect.mapError(invalid));
      const item = { ...before, holder: decoded, updatedAt: yield* now };
      yield* store.save(item);
      return result(item, {
        kind: "work_items.assigned",
        subject: subject(item),
        from: before.holder,
        to: item.holder,
      });
    }),
    claim: Effect.fn("WorkItems.claim")(function* (actor: Actor, id: string) {
      const before = yield* writable(actor, id);
      if (closed(before.status)) return yield* new WorkItemClosed();
      const holder = { kind: options.claim.holderKind, id: actor.id };
      const heldByCaller = sameRef(before.holder, holder);
      if (before.holder !== null && !heldByCaller)
        return yield* new WorkItemHeld({ holder: before.holder });
      if (heldByCaller && before.status === options.claim.toState)
        return { item: before, events: [] };
      const moved =
        before.status === options.claim.toState
          ? { ...before, updatedAt: yield* now }
          : yield* move(before, options.claim.toState);
      const item = { ...moved, holder };
      if (!(yield* store.claim(item))) {
        const current = yield* store.get(id);
        if (current?.holder != null) return yield* new WorkItemHeld({ holder: current.holder });
        return yield* new WorkItemNotFound();
      }
      return result(item, {
        kind: "work_items.claimed",
        subject: subject(item),
        from: holding(before),
        to: holding(item),
      });
    }),
    release: Effect.fn("WorkItems.release")(function* (actor: Actor, id: string) {
      const before = yield* writable(actor, id);
      if (before.holder === null && before.status !== options.release.from)
        return { item: before, events: [] };
      const moved =
        before.status === options.release.from
          ? yield* move(before, options.release.to)
          : { ...before, updatedAt: yield* now };
      const item = { ...moved, holder: null };
      yield* store.save(item);
      return result(item, {
        kind: "work_items.released",
        subject: subject(item),
        from: holding(before),
        to: holding(item),
      });
    }),
    list: Effect.fn("WorkItems.list")(function* (actor: Actor, input: WorkItemFilters = {}) {
      const filters = yield* Schema.decodeEffect(WorkItemFilters)(input).pipe(
        Effect.mapError(invalid),
      );
      if (filters.container !== undefined)
        yield* requireAccess(actor, filters.container, false, true);
      if (filters.inbox) yield* requireAccess(actor, null, false);
      if (filters.holder !== undefined)
        yield* decodeHolder(filters.holder).pipe(Effect.mapError(invalid));
      if (
        filters.state !== undefined &&
        !options.states.some((state) => state.name === filters.state)
      )
        return yield* invalid();
      const size = Math.min(filters.size ?? options.maxPageSize, options.maxPageSize);
      const states =
        filters.category === undefined
          ? undefined
          : options.states
              .filter((state) => state.category === filters.category)
              .map((state) => state.name);
      const rows = yield* store.list(yield* visible(actor), {
        ...filters,
        size: size + 1,
        ...(states === undefined ? {} : { states }),
      });
      const items = rows.slice(0, size);
      const last = items[items.length - 1];
      return rows.length > size && last !== undefined
        ? { items, next: { createdAt: last.createdAt, id: last.id } }
        : { items };
    }),
    tree: Effect.fn("WorkItems.tree")(function* (actor: Actor, container: WorkItemRef | null) {
      yield* requireAccess(actor, container, false);
      const items = yield* store.list(yield* visible(actor), {
        container,
        size: options.maxTreeSize + 1,
      });
      if (items.length > options.maxTreeSize) return yield* new WorkItemTreeTooLarge();
      return workItemTree(items, options.maxDepth);
    }),
    removeContainer: Effect.fn("WorkItems.removeContainer")(function* (ref: WorkItemRef) {
      yield* UnitOfWork.required;
      const container = yield* decodeContainer(ref).pipe(Effect.mapError(invalid));
      if (container !== null) yield* store.removeContainer(container);
    }),
    releaseHolder: Effect.fn("WorkItems.releaseHolder")(function* (ref: WorkItemRef) {
      yield* UnitOfWork.required;
      const holder = yield* decodeHolder(ref).pipe(Effect.mapError(invalid));
      if (holder !== null) yield* store.releaseHolder(holder, yield* now);
    }),
  };
};
