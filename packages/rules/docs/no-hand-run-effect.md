# No hand-run Effect rule

Rule ID: `house-rules/no-hand-run-effect`

A test runs its Effects through `@effect/vitest`: `it.effect` for one case, `it.layer` to provide services. A test that calls `Effect.runPromise` or builds a `ManagedRuntime` runs outside that harness. It gets no test scope and no test clock, and a runtime it builds is never disposed. The rule reports both. Enable it with `plugin.configs.capability`, which runs it on test files: any JS or TS file under a `tests/`, `test/`, or `__tests__/` folder, or named `*.test.*` or `*.spec.*`. These are the same test paths Dependency Cruiser treats as tests.

```ts
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

it.effect("shows a booking", () =>
  Effect.gen(function* () {
    expect(yield* showBooking.handler({ id: "b-1" })).toEqual(booking);
  }),
); // passes

test("shows a booking", async () => {
  expect(await Effect.runPromise(program)).toEqual(booking); // reported
});
```

The message is `Effect.runPromise runs an Effect by hand. Write the test with it.effect or it.layer from @effect/vitest, and provide services with a Layer.`

## What the rule checks

It reports a reference to:

| Name | Imported from |
| --- | --- |
| `Effect.run*`: `runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, `runCallback`, and their `*With` forms | `effect`, or `effect/Effect` as a namespace or as a named import |
| `ManagedRuntime.make` | `effect`, or `effect/ManagedRuntime` as a namespace or as `make` |

A reference counts, not only a call, so `effect.pipe(Effect.runPromise)` is reported too. The rule follows:

- aliases (`import { Effect as E }`) and barrel namespaces (`All.Effect.runSync`);
- a `const` alias of the namespace (`const E = Effect; E.runPromise(p)`);
- destructuring from the namespace, also renamed, with defaults, nested, or assigned (`const { runPromise: run = fallback } = Effect`, `const { Effect: { runPromise } } = All`);
- a direct re-export (`export { runPromise } from "effect/Effect"`, `export { make as build } from "effect/ManagedRuntime"`);
- casts and computed names such as `Effect["runSync"]`.

It resolves names through scopes, so a local `Effect` or a type-only import is not reported. A destructured runner is reported where it is destructured, not where it is called.

## Options

None. No test file is exempt. A production entry point, such as `src/main.ts` or `src/server/runtime.ts`, is not a test file, so it may build a runtime and run Effects.

## Limits

It does not follow a `let` alias, a namespace passed as an argument, or a value passed through another module. It checks the default test folders only. A custom `testsDir` in the Dependency Cruiser settings does not reach the ESLint globs. A test helper file outside a `tests/` folder is not a test file. Keep test helpers inside `tests/`, as the layout rules already require.
