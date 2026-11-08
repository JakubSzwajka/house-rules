import * as Schema from "effect/Schema";

export const Category = Schema.Literals(["open", "active", "done", "cancelled"]);

export const Workflow = Schema.Struct({
  states: Schema.Array(Schema.Struct({ name: Schema.NonEmptyString, category: Category })),
  initial: Schema.NonEmptyString,
  transitions: Schema.Record(
    Schema.String,
    Schema.Union([Schema.Literal("any"), Schema.Array(Schema.NonEmptyString)]),
  ),
  claim: Schema.NonEmptyString,
  release: Schema.Struct({ from: Schema.NonEmptyString, to: Schema.NonEmptyString }),
}).check(
  Schema.makeFilter((w) => {
    const names = w.states.map((state) => state.name);
    const known = (name: string) => names.includes(name);
    return (
      new Set(names).size === names.length &&
      [w.initial, w.claim, w.release.from, w.release.to].every(known) &&
      !isClosed(w, w.claim) &&
      allows(w, w.release.from, w.release.to) &&
      Object.entries(w.transitions).every(
        ([from, to]) => known(from) && (to === "any" || to.every(known)),
      )
    );
  }),
);
export type Workflow = typeof Workflow.Type;

const categoryOf = (w: Workflow, status: string) =>
  w.states.find((state) => state.name === status)?.category;

export const isClosed = (w: Workflow, status: string): boolean => {
  const category = categoryOf(w, status);
  return category === "done" || category === "cancelled";
};

export const allows = (w: Workflow, from: string, to: string): boolean => {
  const allowed = w.transitions[from];
  return categoryOf(w, to) !== undefined && (allowed === "any" || (allowed?.includes(to) ?? false));
};

export const closedAtAfter = (
  w: Workflow,
  from: string,
  to: string,
  closedAt: number | null,
  now: number,
): number | null => {
  if (!isClosed(w, to)) return null;
  return categoryOf(w, to) === categoryOf(w, from) ? (closedAt ?? now) : now;
};

export const board: Workflow = {
  states: [
    { name: "todo", category: "open" },
    { name: "doing", category: "active" },
    { name: "blocked", category: "active" },
    { name: "done", category: "done" },
    { name: "dropped", category: "cancelled" },
  ],
  initial: "todo",
  transitions: { todo: "any", doing: "any", blocked: "any", done: "any", dropped: "any" },
  claim: "doing",
  release: { from: "doing", to: "todo" },
};
