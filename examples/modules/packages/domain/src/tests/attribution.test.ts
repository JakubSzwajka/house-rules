import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ActedFor } from "@house-rules/stack";
import * as Modules from "../index.ts";

const modules = {
  Comments: Modules.Comments,
  Contacts: Modules.Contacts,
  Notes: Modules.Notes,
  Notifications: Modules.Notifications,
  Organisations: Modules.Organisations,
  Projects: Modules.Projects,
  Relations: Modules.Relations,
  WorkItems: Modules.WorkItems,
};

const withFields = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if ((typeof value !== "function" && typeof value !== "object") || value === null)
    return undefined;
  const fields: unknown = Reflect.get(value, "fields");
  return typeof fields === "object" && fields !== null
    ? (fields as Readonly<Record<string, unknown>>)
    : undefined;
};

const recorded = Object.entries(modules).flatMap(([module, exports]) =>
  Object.entries(exports).flatMap(([name, value]) => {
    const fields = withFields(value);
    return fields !== undefined && "by" in fields ? [{ name: `${module}.${name}`, fields }] : [];
  }),
);

describe("attribution", () => {
  it("records for beside by on every stack event and view item", () => {
    expect(recorded.length).toBeGreaterThanOrEqual(35);
    expect(recorded.filter(({ fields }) => fields["for"] !== ActedFor)).toEqual([]);
  });

  it.effect("decodes events stored before for existed with for: null", () =>
    Effect.gen(function* () {
      const target = { kind: "booking", id: "b-1" };
      const added = yield* Schema.decodeEffect(Modules.Comments.CommentAdded)({
        _tag: "CommentAdded",
        target,
        by: "ann",
        body: "hi",
      });
      expect(added.for).toBeNull();
      const related = yield* Schema.decodeEffect(Modules.Relations.EdgeRelated)({
        _tag: "EdgeRelated",
        from: "project:p-1",
        type: "contains",
        to: "work-item:w-1",
        by: "agent:claude",
      });
      expect(related.for).toBeNull();
    }),
  );
});
