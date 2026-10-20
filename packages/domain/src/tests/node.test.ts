import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { defineNode, errorKind, NoInput, NoOpenUnit, UnitOfWorkFailed } from "../index.ts";

class Missing extends Schema.TaggedError<Missing>()("Missing", { kind: errorKind("not_found") }) {}

it("constructs kinded errors without a kind argument", () => {
  expect(new Missing().kind).toBe("not_found");
  expect(Schema.decodeUnknownSync(Missing)({ _tag: "Missing", kind: "not_found" }).kind).toBe(
    "not_found",
  );
  expect(new NoOpenUnit().kind).toBe("unavailable");
  expect(new UnitOfWorkFailed({ reason: "offline" }).kind).toBe("unavailable");
});

it("keeps descriptor schemas, literal flags and default data", () => {
  const node = defineNode("read", {
    description: "Read an item",
    input: NoInput,
    output: Schema.String,
    failure: Missing,
    permission: "items:read",
    readOnly: true,
  });
  expect(node.input).toBe(NoInput);
  expect(node.output).toBe(Schema.String);
  expect(node.failure).toBe(Missing);
  expect(node.edges).toEqual([]);
  expect(node.readOnly).toBe(true);
  expect(node.destructive).toBe(false);
  expect(node.transactional).toBe(false);
  expect(node.needsApproval).toBe(false);
  expect(Object.isFrozen(node)).toBe(true);
  expect("marker" in node).toBe(false);
});
