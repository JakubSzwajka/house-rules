import { Schema } from "effect";
import { WorkItemCategory } from "./work-item.js";
const cap = Schema.Int.check(Schema.isGreaterThan(0));
export const WorkItemsOptions = Schema.Struct({
  states: Schema.Array(
    Schema.Struct({ name: Schema.NonEmptyString, category: WorkItemCategory }),
  ).check(Schema.isMinLength(1)),
  initial: Schema.NonEmptyString,
  transitions: Schema.Record(
    Schema.String,
    Schema.Union([Schema.Literal("any"), Schema.Array(Schema.NonEmptyString)]),
  ),
  claim: Schema.Struct({ toState: Schema.NonEmptyString, holderKind: Schema.NonEmptyString }),
  release: Schema.Struct({ from: Schema.NonEmptyString, to: Schema.NonEmptyString }),
  maxDepth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  containerKinds: Schema.Array(Schema.NonEmptyString),
  holderKinds: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  maxTitleLength: cap,
  maxBodyLength: cap,
  maxPageSize: cap,
  maxTreeSize: cap,
}).check(
  Schema.makeFilter((options) => {
    const names = options.states.map((state) => state.name);
    const known = (name: string) => names.includes(name);
    const live = (name: string) =>
      options.states.some(
        (state) =>
          state.name === name && (state.category === "open" || state.category === "active"),
      );
    return (
      new Set(names).size === names.length &&
      new Set(options.containerKinds).size === options.containerKinds.length &&
      new Set(options.holderKinds).size === options.holderKinds.length &&
      [options.initial, options.claim.toState, options.release.from, options.release.to].every(
        known,
      ) &&
      options.holderKinds.includes(options.claim.holderKind) &&
      live(options.claim.toState) &&
      Object.entries(options.transitions).every(
        ([from, to]) => known(from) && (to === "any" || to.every(known)),
      )
    );
  }),
);
export type WorkItemsOptions = typeof WorkItemsOptions.Type;
export const workItemsPresets = {
  board: {
    states: [
      { name: "todo", category: "open" },
      { name: "doing", category: "active" },
      { name: "blocked", category: "active" },
      { name: "done", category: "done" },
      { name: "dropped", category: "cancelled" },
    ],
    initial: "todo",
    transitions: { todo: "any", doing: "any", blocked: "any", done: "any", dropped: "any" },
    claim: { toState: "doing", holderKind: "person" },
    release: { from: "doing", to: "todo" },
    maxDepth: 1,
    containerKinds: ["project"],
    holderKinds: ["person"],
    maxTitleLength: 200,
    maxBodyLength: 20000,
    maxPageSize: 100,
    maxTreeSize: 500,
  },
} as const satisfies { readonly board: WorkItemsOptions };
