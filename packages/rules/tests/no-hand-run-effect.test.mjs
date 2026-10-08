import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const TEST_FILE = "apps/api/src/use-cases/tests/show-booking.test.ts";

function lint(code, filename = TEST_FILE) {
  const messages = new Linter().verify(code, plugin.configs.capability, { filename });
  assert.equal(
    messages.some((message) => message.fatal),
    false,
    messages.map((message) => message.message).join("\n"),
  );
  return messages
    .filter(({ ruleId }) => ruleId === "house-rules/no-hand-run-effect")
    .map(({ message, line }) => [message.split(" ")[0], line]);
}

test("flags every Effect.run* and ManagedRuntime.make from the barrel", () => {
  const code = `import { Effect, ManagedRuntime } from "effect";
await Effect.runPromise(Effect.void);
Effect.runSync(Effect.void);
Effect.runFork(Effect.void);
Effect.runCallback(Effect.void);
await Effect.runPromiseExit(Effect.void);
Effect.runSyncExit(Effect.void);
Effect["runPromiseWith"](context)(Effect.void);
ManagedRuntime.make(layer);`;
  assert.deepEqual(lint(code), [
    ["Effect.runPromise", 2],
    ["Effect.runSync", 3],
    ["Effect.runFork", 4],
    ["Effect.runCallback", 5],
    ["Effect.runPromiseExit", 6],
    ["Effect.runSyncExit", 7],
    ["Effect.runPromiseWith", 8],
    ["ManagedRuntime.make", 9],
  ]);
});

test("flags module namespaces, barrel namespaces, aliases, named imports and bare references", () => {
  const code = `import * as Fx from "effect/Effect";
import * as All from "effect";
import * as MR from "effect/ManagedRuntime";
import { Effect as E } from "effect";
import { runSync, make } from "effect/Effect";
import { make as makeRuntime } from "effect/ManagedRuntime";
Fx.runPromise(Fx.void);
All.Effect.runSync(All.Effect.void);
MR.make(layer);
E.runFork.call(undefined, E.void);
(E as typeof E).runPromise(E.void);
E.void.pipe(E.runPromise);`;
  assert.deepEqual(lint(code), [
    ["Effect.runSync", 5],
    ["ManagedRuntime.make", 6],
    ["Effect.runPromise", 7],
    ["Effect.runSync", 8],
    ["ManagedRuntime.make", 9],
    ["Effect.runFork", 10],
    ["Effect.runPromise", 11],
    ["Effect.runPromise", 12],
  ]);
});

test("flags direct runner re-exports, renamed too", () => {
  const code = `export { runPromise } from "effect/Effect";
export { runSync as run, Effect } from "effect/Effect";
export { make } from "effect/ManagedRuntime";
export { make as makeRuntime } from "effect/ManagedRuntime";
export { "runFork" as fork } from "effect/Effect";`;
  assert.deepEqual(lint(code), [
    ["Effect.runPromise", 1],
    ["Effect.runSync", 2],
    ["ManagedRuntime.make", 3],
    ["ManagedRuntime.make", 4],
    ["Effect.runFork", 5],
  ]);
});

test("passes re-exports of other names, type re-exports and other modules", () => {
  const code = `export { Effect, Layer } from "effect";
export { succeed, void as nothing } from "effect/Effect";
export { isManagedRuntime } from "effect/ManagedRuntime";
export type { runPromise } from "effect/Effect";
export { runPromise } from "./local-effect";
export { runPromise as other } from "effect/Layer";`;
  assert.deepEqual(lint(code), []);
});

test("flags runners destructured from an Effect namespace", () => {
  const code = `import { Effect, ManagedRuntime } from "effect";
import * as Fx from "effect/Effect";
import * as All from "effect";
const { runPromise } = Effect;
const { runSync: run, runFork: fork = fallback } = Fx;
const { make: makeRuntime } = ManagedRuntime;
const { Effect: { runPromiseExit }, ManagedRuntime: { make: build } } = All;
const { runCallback = fallback } = All.Effect;
let later;
({ runSync: later } = Effect);
runPromise(program);`;
  assert.deepEqual(lint(code), [
    ["Effect.runPromise", 4],
    ["Effect.runSync", 5],
    ["Effect.runFork", 5],
    ["ManagedRuntime.make", 6],
    ["Effect.runPromiseExit", 7],
    ["ManagedRuntime.make", 7],
    ["Effect.runCallback", 8],
    ["Effect.runSync", 10],
  ]);
});

test("flags a runner reached through a const alias of the namespace", () => {
  const code = `import { Effect } from "effect";
import * as All from "effect";
const E = Effect;
const F = E;
const G = All.Effect;
E.runPromise(program);
F.runSync(program);
G.runFork(program);
const { runCallback } = F;
function inner() {
  return E.runPromiseExit(program);
}`;
  assert.deepEqual(lint(code), [
    ["Effect.runPromise", 6],
    ["Effect.runSync", 7],
    ["Effect.runFork", 8],
    ["Effect.runCallback", 9],
    ["Effect.runPromiseExit", 11],
  ]);
});

test("passes destructuring and aliases that are not the runners", () => {
  const code = `import { Effect, ManagedRuntime } from "effect";
import * as All from "effect";
const { succeed, gen, void: nothing } = Effect;
const { Effect: { fail }, Layer } = All;
const { isManagedRuntime } = ManagedRuntime;
const { runPromise } = somethingElse;
const { runPromise: other } = { runPromise: 1 };
const { [computed]: dynamic } = Effect;
const { ...rest } = Effect;
const E = Effect;
E.succeed(1);
let Mutable = Effect;
Mutable.runPromise(program);
function inner(Effect) {
  const { runPromise } = Effect;
  const Local = Effect;
  return Local.runPromise(program) ?? runPromise;
}
function shadow() {
  const E = somethingElse;
  return E.runPromise(program);
}`;
  assert.deepEqual(lint(code), []);
});

test("the capability preset covers every test folder the cruiser names", () => {
  const code =
    'import { Effect } from "effect";\nexport const run = () => Effect.runPromise(Effect.void);';
  for (const filename of [
    "src/test/x.ts",
    "src/__tests__/x.ts",
    "src/tests/x.ts",
    "test/x.ts",
    "__tests__/x.ts",
    "tests/x.ts",
    "apps/api/src/use-cases/__tests__/deep/nested/show.ts",
    "packages/bookings/src/test/fixtures.ts",
    "src/x.test.ts",
    "src/x.spec.mts",
  ]) {
    assert.deepEqual(lint(code, filename), [["Effect.runPromise", 2]], filename);
  }
  for (const filename of [
    "src/testing/x.ts",
    "src/contest/x.ts",
    "src/__test__/x.ts",
    "src/x.tests.ts",
  ]) {
    assert.deepEqual(lint(code, filename), [], filename);
  }
});

test("passes @effect/vitest tests, other Effect APIs, type imports and shadowed names", () => {
  const code = `import { expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime as Runtime } from "effect";
import type { ManagedRuntime } from "effect";
import { Effect as Local } from "./local-effect";
it.effect("shows a booking", () =>
  Effect.gen(function* () {
    expect(yield* Effect.succeed(1)).toBe(1);
  }),
);
it.layer(Layer.empty)("group", (test) => test.effect("case", () => Effect.void));
Effect.make;
Effect.runner;
Runtime.isManagedRuntime(value);
Local.runPromise(value);
type R = ManagedRuntime.ManagedRuntime<never, never>;
function inner(Effect) {
  return Effect.runPromise(value);
}`;
  assert.deepEqual(lint(code), []);
});

test("the capability preset runs it on test files only", () => {
  const code =
    'import { Effect } from "effect";\nexport const run = () => Effect.runPromise(Effect.void);';
  for (const filename of [
    "apps/api/src/use-cases/tests/show-booking.test.ts",
    "packages/bookings/src/tests/bookings.test.ts",
    "packages/bookings/src/tests/fixtures.ts",
    "tests/wiring.test.mjs",
    "src/thing.spec.tsx",
    "src/thing.test.js",
  ]) {
    assert.deepEqual(lint(code, filename), [["Effect.runPromise", 2]], filename);
  }
  for (const filename of ["apps/api/src/main.ts", "apps/api/src/server/runtime.ts"]) {
    assert.deepEqual(lint(code, filename), [], filename);
  }
});

test("the message points at @effect/vitest", () => {
  assert.match(
    plugin.rules["no-hand-run-effect"].meta.messages.handRun,
    /it\.effect or it\.layer from @effect\/vitest/,
  );
});
