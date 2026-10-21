import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { defineOperation, errorKind, NoInput, NoOpenUnit, UnitOfWorkFailed } from "../index.ts";

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
  const callable = defineOperation("read", {
    description: "Read an item",
    input: NoInput,
    output: Schema.String,
    failure: Missing,
    permission: "items:read",
    readOnly: true,
  });
  expect(callable.input).toBe(NoInput);
  expect(callable.output).toBe(Schema.String);
  expect(callable.failure).toBe(Missing);
  expect(callable.edges).toEqual([]);
  expect(callable.readOnly).toBe(true);
  expect(callable.destructive).toBe(false);
  expect(callable.transactional).toBe(false);
  expect(callable.needsApproval).toBe(false);
  expect(Object.isFrozen(callable)).toBe(true);
  expect("marker" in callable).toBe(false);
});
