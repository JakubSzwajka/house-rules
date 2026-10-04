# @house-rules/capability

A capability is one named action an app offers, such as "show a booking". It has a contract and one handler. The contract holds the name, a description, Effect Schemas for the input, the output and the failure, and two flags: `readOnly` and `destructive`. The handler is an Effect that takes the decoded input and gets its services from Layers. An MCP tool is built from the contract with `toTool`, and HTTP or CLI adapters can later be built the same way, so each action is written once.

```text
adapter      HTTP route   MCP tool   CLI command    decides who calls, maps errors
                  \           |          /
capability          showBooking contract + handler     one action, typed in and out
                              |
service             Bookings (a module's interface)     rules, access checks, data
```

A module is a deep piece of behavior: an interface plus a private implementation. Its service, a `Context.Service` class, is that interface. A capability is one action offered on top of the service; the module knows nothing about it. Access and permission checks stay inside the service. The contract only carries the `readOnly` and `destructive` flags, so an adapter can tell a read from a write.

## Usage

```ts
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { defineContract, implement } from "@house-rules/capability";

class Greetings extends Context.Service<
  Greetings,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("app/Greetings") {
  static readonly layer = Layer.succeed(this, {
    greet: (name: string) => Effect.succeed(`Hello, ${name}`),
  });
}

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

const greetContract = defineContract("greet", {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
  annotations: { readOnly: true },
});

const greet = implement(greetContract, ({ name }) =>
  Effect.gen(function* greetHandler() {
    if (name === "") {
      return yield* new NameIsEmpty();
    }
    const greetings = yield* Greetings;
    return yield* greetings.greet(name);
  }),
);

it.layer(Greetings.layer)("greet", (test) => {
  test.effect("greets by name", () =>
    Effect.gen(function* greetsByName() {
      expect(yield* greet.handler({ name: "Ada" })).toBe("Hello, Ada");
    }),
  );
});
```

`greet.handler` has the type `(input: { readonly name: string }) => Effect<string, NameIsEmpty, Greetings>`. The `Greetings` requirement comes from the handler itself. Provide it with a Layer, as the test does. A handler that fails with an error the contract does not declare, or returns a value the output schema does not allow, is a type error.

`annotations` is optional. Each flag you leave out is `false`.

## An action with no input

Some actions take no input, such as "list my trips". Give them `NoInput` as the input schema:

```ts
import { Effect, Schema } from "effect";
import { defineContract, implement, NoInput } from "@house-rules/capability";

const pingContract = defineContract("ping", {
  description: "Answer pong.",
  input: NoInput,
  output: Schema.String,
  failure: Schema.Never,
  annotations: { readOnly: true },
});

const ping = implement(pingContract, () => Effect.succeed("pong"));

const pong = ping.handler({}); // Effect<string>: the handler takes an empty object
```

Do not use `Schema.Struct({})` for this. Effect renders it to JSON Schema as `{"not":{"type":"null"}}`, with no `type`. An MCP tool's input schema must have `"type": "object"`, so Effect's `McpServer` fails to list every tool with `SchemaError: Missing key at ["type"]`. `NoInput` is `Schema.Record(Schema.String, Schema.Never)`, the same shape as Effect's `Tool.EmptyParams`. It renders as `{"type":"object","additionalProperties":false}`, so an MCP tool can use `contract.input` as its `parameters` as is. Checked with `effect` 4.0.0-rc.117.

## Install in another app

The package is not on npm. Install it from GitHub, pinned to a full 40-character commit of this repo, with a pnpm subpath:

```json
{
  "dependencies": {
    "@house-rules/capability": "github:JakubSzwajka/house-rules#<full-40-char-sha>&path:/packages/capability",
    "effect": "4.0.0-rc.117"
  }
}
```

1. [ ] Use pnpm. npm has no subpath selector for Git dependencies and installs the whole repo root instead, which is the wrong package (checked). Yarn is not checked against this repo.
2. [ ] Pin `effect` to the same exact version this package names in `peerDependencies`. It is an exact peer, and the handler types come from that copy of `effect`.
3. [ ] A young Effect release candidate fails pnpm's `minimumReleaseAge` check. If your `pnpm-workspace.yaml` sets it, add `effect@<version>` to `minimumReleaseAgeExclude`.
4. [ ] The package ships TypeScript source and has no build step. Your `tsc` compiles it as part of your program. Use TypeScript 7 or 6 with `module` and `moduleResolution` set to `NodeNext`, and `skipLibCheck: true`. It is tested with TypeScript 7.0.2.
5. [ ] Its files import each other with `.ts` extensions, so your tsconfig also needs `allowImportingTsExtensions: true`. TypeScript allows that flag only with `noEmit` or `emitDeclarationOnly`. If your `tsc` emits JavaScript, set `rewriteRelativeImportExtensions: true` instead. Without either flag, `tsc` fails with error `TS5097` on those imports.
6. [ ] Or extend `@house-rules/rules/tsconfig/effect.json`, installed from the same commit as [the root README](../../README.md#using-the-rules-in-another-app) shows. The package passes its strict flags. The preset sets `noEmit` but not `allowImportingTsExtensions`, so add that flag yourself. Its Effect diagnostics run only after `pnpm exec effect-tsgo patch` from `@effect/tsgo`, as this repo's `prepare` script does.
7. [ ] In a Next.js app, add `@house-rules/capability` to `transpilePackages` in `next.config.ts`. Without it, a Turbopack build fails with `Unknown module type`, because Next does not compile TypeScript in `node_modules`. The app's tsconfig needs `allowImportingTsExtensions: true` too, or the type check in `next build` fails with `TS5097`. Checked with Next 16.3.5 and `next build` on Turbopack.
8. [ ] The usage example is a test, so it needs two dev dependencies, pinned exactly: `"@effect/vitest": "4.0.0-rc.117"` and `"vitest": "5.0.1"` (the versions this repo uses). Run the code through a tool that compiles dependencies. Vitest does, so the test above runs as is. Plain `node` will not strip types inside `node_modules`, and fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
9. [ ] To upgrade, change the SHA and run `pnpm install`.

## An MCP tool from a contract

`toTool(contract, options)` builds an `effect/unstable/ai` `Tool` from a contract, so an MCP adapter does not write the tool by hand. The contract gives the name, the description, the parameters (`contract.input`), and the `Tool.Readonly` and `Tool.Destructive` annotations. The options carry what only MCP needs:

| Option | Required | Becomes |
| --- | --- | --- |
| `title` | yes | `Tool.Title` |
| `idempotent` | yes | `Tool.Idempotent` |
| `openWorld` | yes | `Tool.OpenWorld` |
| `success` | no | the tool's success schema; defaults to `contract.output` |
| `failure` | no | the tool's failure schema; defaults to `contract.failure` |

```ts
import { Toolkit } from "effect/unstable/ai";
import { toTool } from "@house-rules/capability";

export const Greet = toTool(greet.contract, {
  title: "Greet someone",
  idempotent: true,
  openWorld: false,
});

export const tools = Toolkit.make(Greet);
export const toolHandlers = tools.toLayer({ greet: (input) => greet.handler(input) });
```

`idempotent` and `openWorld` are required because Effect defaults `openWorld` to `true`, and an agent client reads the hint. Each MCP adapter decides them. Pass `success` when the tool returns a view of the output, and `failure` when the adapter maps the contract's errors to its own error, such as a `ToolProblem`. The handler you pass to `toLayer` then maps to those schemas.

The tool type keeps the contract's exact types: `Tool<"greet", { parameters: typeof GreetInput; success: ...; failure: ... }>`. `toTool` is typed over `Contract<Name, Input, Output, Failure>`, not over `C extends AnyContract`. The constraint form widens the input to `InputSchema`, so the tool loses its exact parameter type. An override the options type marks optional, such as `success?: typeof View`, types the schema as `typeof View | typeof Output`, because at run time it may be either one. A `NoInput` contract renders its parameters as `{"type":"object","additionalProperties":false}`.

The house plugin's `no-hand-rolled-surface` rule fails on `Tool.make` outside this package, so every MCP tool comes from a contract.

## Limits

This is v0. It has `defineContract`, `implement`, `NoInput` and `toTool`, and nothing else. There is no registry of capabilities, and nothing turns a contract into an HTTP route or a CLI command yet. The handler takes the decoded input. Decoding raw input with the contract's schema is the adapter's job. For MCP, Effect's `McpServer` decodes it with the tool's parameters.

## Exports

`defineContract`, `implement`, `toTool`, the `NoInput` schema, and the types `Contract`, `AnyContract`, `Annotations`, `InputSchema`, `PlainSchema`, `Capability`, `ContractTool`, and `ToToolOptions`.
