import {
  Actor,
  ActorId,
  asSystem,
  defineOperation,
  memoryUnitOfWork,
  NoInput,
} from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import {
  bindOperation,
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  type Plan,
  protectedResource,
  StepTrace,
  systemStart,
} from "../../index.ts";

class Store extends Context.Service<Store, object>()("test/plan/Store") {}
class Views extends Context.Service<Views, object>()("test/plan/Views") {}
class Slot extends Context.Service<Slot, (event: unknown) => Effect.Effect<void, string>>()(
  "test/plan/Slot",
) {}

const base = {
  description: "Test.",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
} as const;
const stub = () => Effect.void;
const audit = defineOperation("Store.audit", {
  ...base,
  permission: "audit:write",
  transactional: true,
});
const save = defineOperation("Store.save", {
  ...base,
  permission: "items:write",
  edges: [asSystem(audit, "audit trail")],
  transactional: true,
});
const remove = defineOperation("Store.remove", {
  ...base,
  permission: "items:remove",
  transactional: true,
  destructive: true,
  needsApproval: true,
});
const list = defineOperation("Views.list", { ...base, permission: "items:read", readOnly: true });
const listItems = defineFeature("list_items", {
  ...base,
  permission: null,
  edges: [list],
  flags: { readOnly: true },
  handler: stub,
});
const saveItem = defineFeature("save_item", {
  ...base,
  permission: "app:use",
  edges: [save, listItems],
  handler: stub,
});
const removeItem = defineFeature("remove_item", {
  ...base,
  permission: null,
  edges: [remove],
  handler: stub,
});
const signUp = defineFeature("sign_up", {
  ...base,
  permission: null,
  edges: [save],
  start: systemStart("public sign-up", "visitor"),
  handler: stub,
});
const nightlySelect = defineFeature("nightly_select", {
  ...base,
  output: Schema.Array(NoInput),
  permission: null,
  edges: [list],
  flags: { readOnly: true },
  start: systemStart("nightly purge"),
  handler: () => Effect.succeed([]),
});
const nightlyItem = defineFeature("nightly_item", {
  ...base,
  permission: null,
  edges: [asSystem(remove, "expired item")],
  start: systemStart("nightly purge"),
  handler: stub,
});
const onChange = defineFeature("on_change", {
  ...base,
  permission: null,
  edges: [save],
  start: systemStart("item changed"),
  handler: stub,
});
const hidden = defineFeature("hidden_report", {
  ...base,
  permission: null,
  edges: [list],
  handler: stub,
});
const features = [
  listItems,
  saveItem,
  removeItem,
  signUp,
  nightlySelect,
  nightlyItem,
  onChange,
  hidden,
];
const who = { resolve: () => Effect.succeed(Actor.make({ id: ActorId.make("tester") })) };
const ways = [
  defineWay({
    protocol: "http",
    name: "web",
    path: "/api",
    features: [listItems, saveItem, removeItem, signUp],
    public: [signUp],
    endpoints: [listItems, saveItem, removeItem, signUp].map((feature) => endpoint(feature)),
    who,
    mean: Mean.no,
  }),
  defineWay({
    protocol: "mcp",
    name: "mcp",
    path: "/mcp",
    features: [listItems],
    tools: [{ feature: listItems, title: "List", idempotent: true, openWorld: false }],
    server: { name: "test", version: "1" },
    resource: protectedResource(undefined, "/mcp"),
    who,
    mean: Mean.elicitation,
  }),
  defineWay({
    protocol: "hook",
    name: "changed",
    slot: Slot,
    features: [onChange],
    mean: Mean.allow,
    input: () => ({}),
    failure: () => "mapped",
  }),
  defineWay({
    protocol: "schedule",
    name: "nightly",
    clock: { cron: "0 3 * * *", timeZone: "UTC" },
    features: [nightlySelect, nightlyItem],
    mean: Mean.allow,
    input: {},
  }),
] as const;
const modules = {
  mounts: [
    {
      map: { name: "store", kind: "package", package: "@test/store" },
      service: Store,
      layer: Layer.succeed(Store, {}),
      operations: [audit, save, remove],
      bind: () => [
        bindOperation(audit, stub),
        bindOperation(save, stub),
        bindOperation(remove, stub),
      ],
    },
    {
      map: { name: "views", kind: "read-model" },
      service: Views,
      layer: Layer.succeed(Views, {}),
      operations: [list],
      bind: () => [bindOperation(list, stub)],
    },
  ] as const,
  layer: Layer.merge(StepTrace.layer(), memoryUnitOfWork),
};
export const app = () =>
  composition({
    modules,
    features,
    ways,
    may: Effect.succeed(May.fixed([])),
    system: ["audit:write", "items:read", "items:remove", "items:write"],
  });

export const plan: Plan = {
  modules: [
    {
      name: "store",
      service: "test/plan/Store",
      kind: "package",
      package: "@test/store",
      operations: [
        { name: "Store.audit", permission: "audit:write", transactional: true },
        {
          name: "Store.save",
          permission: "items:write",
          transactional: true,
          edges: [{ target: "Store.audit", reason: "audit trail" }],
        },
        {
          name: "Store.remove",
          permission: "items:remove",
          transactional: true,
          destructive: true,
          needsApproval: true,
        },
      ],
    },
    {
      name: "views",
      service: "test/plan/Views",
      kind: "read-model",
      operations: [{ name: "Views.list", permission: "items:read", readOnly: true }],
    },
  ],
  features: [
    { name: "list_items", permission: null, readOnly: true, edges: ["Views.list"] },
    { name: "save_item", permission: "app:use", edges: ["Store.save", "list_items"] },
    { name: "remove_item", permission: null, edges: ["Store.remove"] },
    {
      name: "sign_up",
      permission: null,
      start: { reason: "public sign-up", startedBy: "visitor" },
      edges: ["Store.save"],
    },
    {
      name: "nightly_select",
      permission: null,
      readOnly: true,
      start: { reason: "nightly purge", startedBy: "nightly purge" },
      edges: ["Views.list"],
    },
    {
      name: "nightly_item",
      permission: null,
      start: { reason: "nightly purge", startedBy: "nightly purge" },
      edges: [{ target: "Store.remove", reason: "expired item" }],
    },
    {
      name: "on_change",
      permission: null,
      start: { reason: "item changed", startedBy: "item changed" },
      edges: ["Store.save"],
    },
    { name: "hidden_report", permission: null, edges: ["Views.list"] },
  ],
  ways: [
    {
      name: "web",
      protocol: "http",
      path: "/api",
      mean: "no",
      features: ["list_items", "save_item", "remove_item", "sign_up"],
      public: ["sign_up"],
    },
    { name: "mcp", protocol: "mcp", path: "/mcp", mean: "elicitation", features: ["list_items"] },
    {
      name: "changed",
      protocol: "hook",
      slot: "test/plan/Slot",
      mean: "allow",
      features: ["on_change"],
    },
    {
      name: "nightly",
      protocol: "schedule",
      clock: { cron: "0 3 * * *", timeZone: "UTC" },
      mean: "allow",
      features: ["nightly_select", "nightly_item"],
    },
  ],
};
