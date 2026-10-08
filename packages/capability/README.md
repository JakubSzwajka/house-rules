# @house-rules/capability

A capability is one named action an app offers, such as "show a booking". It has a contract and one handler. The contract holds the name, a description, Effect Schemas for the input, the output and the failure, two flags, `readOnly` and `destructive`, a `permission`, `needsApproval`, and `transactional`. The handler is an Effect that takes the decoded input and gets its services from Layers. An MCP tool is built from the contract with `toTool`, and HTTP or CLI adapters can later be built the same way, so each action is written once.

```text
adapter      HTTP route   MCP tool   CLI command    decides who calls, maps errors
                  \           |          /
gates               Grant, then Approval               may this caller, does a human mean it
                              |
capability          showBooking contract + handler     one action, typed in and out
                              |
service             Bookings (a module's interface)     rules, checks of one object, data
```

A module is a deep piece of behavior: an interface plus a private implementation. Its service, a `Context.Service` class, is that interface. A capability is one action offered on top of the service; the module knows nothing about it. The contract declares its permission, and `implement` checks it before the handler runs. Checks of one object, such as whether this user owns this trip, stay inside the service. The `readOnly` and `destructive` flags tell an adapter a read from a write.

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
  permission: "public",
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

`permission` is required. `"public"` says, on purpose, that any caller may run the action, and adds nothing to the handler's type. `annotations` is optional. Each flag you leave out is `false`.

## Permissions and approval

Each call runs two gates before the handler. They are `Context.Service` slots that the adapter provides for each request, the way it provides the `Viewer`.

```text
handler(input)
  1 Grant      permission held?        no -> Forbidden({ capabilityName, permission })
  2 Approval   human says yes?         no -> ApprovalDenied({ capabilityName, reason })
  3 handler    the use-case itself
```

1. [ ] **Permission.** A `resource:action` string, such as `trips:delete`, or `"public"`. The module that owns the resource names its permissions. The type rejects a contract without one, and a string without a colon.
2. [ ] **Grant.** `holds(permission) => Effect<boolean>`: does this caller hold the permission at all? It runs before any data is read, so it cannot leak whether a record exists. A non-public contract adds `Grant` to the handler's requirements and `Forbidden` to its failures.
3. [ ] **Approval.** `approve(capabilityName, input) => Effect<void, ApprovalDenied>`: does a human mean this call, now? `needsApproval: true` adds `Approval` to the requirements and `ApprovalDenied` to the failures. `false`, the default, adds nothing.

```ts
import { Approval, defineContract, Grant, implement } from "@house-rules/capability";

const removeTripContract = defineContract("remove_trip", {
  description: "Delete one trip the caller owns.",
  input: Schema.Struct({ tripId: Schema.String }),
  output: Schema.Void,
  failure: TripNotFound,
  permission: "trips:delete",
  needsApproval: true,
  annotations: { destructive: true },
});

const removeTrip = implement(removeTripContract, ({ tripId }) => /* ... */);
// removeTrip.handler: (input) =>
//   Effect<void, TripNotFound | Forbidden | ApprovalDenied, Trips | Viewer | Grant | Approval>

removeTrip.handler({ tripId }).pipe(
  Effect.provideService(Grant, Grant.fromPermissions(memberPermissions)),
  Effect.provide(Approval.allowAll),
);
```

| Cartridge | Type | Use |
| --- | --- | --- |
| `Grant.allowAll`, `Grant.denyAll` | `Layer<Grant>` | tests, or a surface that trusts every caller |
| `Grant.fromPermissions(list)` | `GrantService` value | `Effect.provideService(Grant, ...)` per request |
| `Grant.layerFromPermissions(list)` | `Layer<Grant>` | the same, as a layer |
| `Approval.allowAll`, `Approval.denyAll` | `Layer<Approval>` | the web, where the click is the yes; tests |
| `elicitationApproval` | `Layer<Approval>` | MCP: ask the human through the client |

`elicitationApproval` asks the human through the MCP client with a field-less form: `ApprovalForm` is the requested schema `{ type: "object", properties: {} }`, so the human sees the message and the client's Accept and Decline buttons, with no checkbox. The action is the answer. Accept approves, whatever the content (missing or `{}`). Decline fails with `ApprovalDenied` and the reason "Approval was declined". Cancel fails with "Approval was cancelled". It sends the request itself through the `McpServerClient` instead of `McpServer.elicit`, because `McpServer.elicit` derives the schema from a `Schema.Struct`, and an empty struct has no `type` or `properties`, so it cannot send a field-less form. The message names the capability and shows its input as JSON data, never as instructions (`approvalMessage`). It reads the `McpServerClient` of the current request when `approve` runs, so it works whether you provide it per request or once at startup. It fails closed with `ApprovalDenied` on anything that is not a clean accept: a decline, a cancel, an unexpected answer ("Approval answer was malformed"), a client that does not advertise form elicitation or no MCP client in context ("The MCP client cannot ask a human for approval"), and a failed request, such as a transport error, a JSON-RPC error, or a timeout. A failed request reads "Approval request failed (<Tag>)", so it is not mistaken for a decline. `<Tag>` is the error's `_tag`, or the defect's class name, and only when it is a short identifier (letters, digits, underscore, at most 40). The reason never carries the error's `message`, `reason`, or any other text, because that text can echo user data. With no safe tag it reads "Approval request failed". A result that is null, not an object, or has no known `action` is "Approval answer was malformed", with its decision log line. An agent cannot answer its own approval: the client shows the form to the human. Whether each agent client supports elicitation is not checked here.

Each decision writes one log line with Effect logging: `Effect.logInfo` "Approval granted" or `Effect.logWarning` "Approval denied". The line is annotated with `capability`, `outcome` (`approved` or `denied`), `reason` (denials only), `clientName` and `clientVersion` from the client's `initialize` info, and `formElicitation`, whether the client advertised form elicitation. It never logs the input or any user data.

A wide flag, such as a `needsApproval` typed only as `boolean`, gets both gates in the type. The safe side is to provide more.

### Watching every call

`CallWatch` is a hook around every call, on every surface. `implement` runs each call as `watch.around(contract, input, run, facts)`, where `facts` is optional (a caller that passes three arguments gets `unknownCallFacts(contract)`: the kind from the contract, no target, channel `"unknown"`, no request id) and `run` is the Grant check, then Approval, then the handler. So the watch also sees `Forbidden` and `ApprovalDenied`, and it can measure the whole call. `input` is the decoded input.

`CallWatch` is a `Context.Reference` with a pass-through default. Provide nothing and the call behaves as before. It adds no requirement and no failure to any capability. A watch is trusted code. It must return the exit of `run` unchanged: no `Effect.orDie`, and no skipping `run`. The `Around` type keeps the channels, but it cannot enforce that behaviour.

```ts
import { CallWatch } from "@house-rules/capability";
import { Clock, Effect, Layer } from "effect";

const loggingWatch = Layer.succeed(CallWatch, {
  around: (contract, _input, run) =>
    Effect.gen(function* logCall() {
      const start = yield* Clock.currentTimeMillis;
      return yield* run.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* logExit() {
            const end = yield* Clock.currentTimeMillis;
            yield* Effect.logInfo("capability call").pipe(
              Effect.annotateLogs({
                capability: contract.name,
                permission: contract.permission,
                outcome: exit._tag,
                ms: end - start,
              }),
            );
          }),
        ),
      );
    }),
});
```

The example logs no input values, because input is often user data. A watch that wants the viewer reads it with `Effect.serviceOption`, so it adds no requirement either.

You do not have to write the watch yourself. `@house-rules/call-audit` (`packages/call-audit`, see its README) is one that writes a log line per call, or keeps the entries in memory for tests.

### Call facts: kind, target, channel, request id

The watch gets a fourth argument, `facts`, a `CallFacts`. A watch that takes three arguments still type-checks.

| Fact | Where it comes from |
| --- | --- |
| `kind` | `"read"` when the contract has `annotations: { readOnly: true }`, else `"write"` |
| `targetId` | the input field the contract names in `audit: { target: "tripId" }`, only when its value is a string, capped at 256 characters; else `null` |
| `channel` | `"mcp"` or `"mcp:<client name>"` during an MCP tool call; else the `CallChannel` reference, `"unknown"` by default |
| `requestId` | the `CallRequestId` reference, which `withRequestId` sets; `null` by default |

`audit.target` must name a key of the input whose type can be a string. Naming a number field or a missing key is a type error. It is a field name, not a function, so no computed value can reach the audit.

Review rule: `audit.target` must name an id field, such as `tripId`, never free text such as a title or a note. The type only checks that the value is a string. It cannot prove the string is an id, so `audit: { target: "note" }` compiles and stores the note. Reviewers check each `audit.target` by hand.

The MCP channel needs no wiring. The Effect `McpServer` provides `McpRequestContext` to every tool call, including the tools `toTool` builds, and the facts read the client name from it. The name keeps only letters, digits, `.`, `_`, `-` and spaces, at most 40 characters. An MCP call wins over any `CallChannel` the app set. The app sets the other channels itself, such as `Effect.provideService(CallChannel, "web")` in its web runner. The request id is wired at the app's edge too; see the next section.

### Request id

One id per incoming request ties its audit rows and its log lines together, so a bug report can quote it. The package ships the pieces; the app wires them at its edge:

| Export | What it does |
| --- | --- |
| `requestIdHeader` | `"x-request-id"`, the header the app reads, forwards and echoes |
| `requestIdOf(value)` | the value when it is a safe id (`^[A-Za-z0-9._:-]{1,128}$`), else `null` |
| `newRequestId` | an `Effect<string>`: 32 random hex characters from Effect's `Random`, so a test can seed it |
| `withRequestId(id)` | wraps an effect: provides `CallRequestId` and adds the log annotation `requestId`, so every log line inside carries it, not only the audit line |

```
client ──► proxy / server middleware
             id = requestIdOf(incoming x-request-id) ?? fresh id
             forwards it on the request, echoes it on the response
           ──► route / page / action / MCP route
                 effect.pipe(withRequestId(id))
                 ──► capability ──► audit row request_id = id
                                    log lines {requestId: id}
```

```ts
const id = requestIdOf(request.headers.get(requestIdHeader)) ?? (yield* newRequestId);
return yield* capability.handler(input).pipe(withRequestId(id));
```

A valid incoming id is kept, so an id set by a proxy or a client in front can be followed through. Anything else is replaced. The id only traces a request: it grants nothing and never decides access, so a client that sends its own id can only confuse its own trail. Free text never reaches the audit, because `requestIdOf` lets only id characters through. `withRequestId` is dual: `withRequestId(effect, id)` works too. An inner `withRequestId` wins over an outer one.

### Units of work

A use-case owns the transaction, not the module. One unit of work may cover writes in several modules. `UnitOfWork` is a slot like `Grant`, with two adapters:

| Adapter | Type | Use |
| --- | --- | --- |
| `sqlUnitOfWork` | `Layer<UnitOfWork, never, SqlClient>` | Postgres: one `SqlClient.withTransaction` per unit |
| `memoryUnitOfWork` | `Layer<UnitOfWork>` | memory stores: runs the effect, and on failure runs the rollback hooks the stores registered; one unit at a time |

A use-case opens a unit in one of two ways:

1. [ ] The contract sets `transactional: true`. `implement` runs Grant, then Approval, then the handler inside `UnitOfWork.atomic`, all inside `CallWatch`. A refused call opens no unit. The flag adds `UnitOfWork` to the requirements and `UnitOfWorkFailed` to the failures. `false`, the default, adds nothing.
2. [ ] The handler calls `UnitOfWork.atomic(effect)` around only the part that must be atomic. That adds `UnitOfWork` and `UnitOfWorkFailed` to that effect.

A nested `atomic` joins the open unit: no new transaction, no savepoint. A failure that leaves the outermost unit rolls everything back. `UnitOfWorkFailed({ reason })` means the SQL unit could not begin, commit or roll back. The work's own errors and defects pass through unchanged. When a rollback fails, the cause holds `UnitOfWorkFailed` first, then the work's own failure.

Memory stores have no row locks, so `memoryUnitOfWork` runs top-level units one at a time, per layer instance. A second top-level `atomic` waits until the open unit has committed or run its rollback hooks. Without that wait, a unit whose undo puts back a whole earlier state could wipe out another unit's commit. A nested `atomic`, in the same fiber or in one it forked, joins the open unit and never waits, so it cannot deadlock. A unit is open only while its work runs. It closes when the work ends, before COMMIT, ROLLBACK and the undo hooks. A fiber that outlives or races that end, such as a daemon forked inside it, gets `NoOpenUnit` from `required` and `onRollback`, and should open its own unit with `atomic`: that waits for the permit here, which the closing unit holds until its undo hooks finish, and starts a new transaction in the SQL adapter. On rollback every undo hook runs, newest first, even when one fails or dies, and the unit's cause keeps the work's cause plus each hook's failure. The memory adapter is for tests and scripts; it does not model concurrent transactions.

A module never opens a unit. Its write path checks for one, with no requirement added to the service method:

```ts
// In a module's Postgres store: fails with NoOpenUnit when no unit is open.
put: (booking) => UnitOfWork.required.pipe(Effect.andThen(sql`insert into booking ...`)),

// In a module's memory store: register the undo, then change the map.
put: (booking) =>
  UnitOfWork.onRollback(Effect.sync(() => rows.delete(booking.id))).pipe(
    Effect.andThen(Effect.sync(() => rows.set(booking.id, booking))),
  ),
```

`CurrentUnit` is a `Context.Reference` holding the open unit, `undefined` by default, so reading it adds no requirement. The SQL adapter puts the transaction connection in the fiber's context, so every statement on the same `SqlClient` inside the unit joins it. Build the module stores and `sqlUnitOfWork` from one `SqlClient` layer. Scripts and tests open a unit themselves: `memoryUnitOfWork` with memory stores, or `sqlUnitOfWork` with Postgres stores. `UnitOfWork.make(transaction)` builds another adapter from a function that wraps an effect in a transaction.

A `CallWatch` runs outside the unit, so an audit row written there survives a rollback.

### Relations and policy

A relation is how the caller stands to one object, such as owner or shared. The module checks the relation against its own data. `definePolicy` gives the shape:

```ts
import { definePolicy } from "@house-rules/capability";

export const tripPolicy = definePolicy({
  owner: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  shared: ["trips:read", "trips:write"],
});

tripPolicy.allows("shared", "trips:delete"); // false
tripPolicy.table(); // { owner: { "trips:read": true, ... }, shared: { ..., "trips:delete": false } }
```

`table()` is pure, so a test compares the whole who × action table to a literal. A permission no relation holds does not appear in the table.

An object also has a state, such as a Trip that is active or frozen. `withStates` adds that dimension and leaves the relation-only policy as it was:

```ts
export const tripPolicy = definePolicy({
  owner: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  shared: ["trips:read", "trips:write"],
}).withStates({
  active: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  frozen: ["trips:read", "trips:delete"],
});

tripPolicy.allows("owner", "frozen", "trips:write"); // false: the state does not carry it
tripPolicy.allows("owner", "frozen", "trips:delete"); // true: both carry it
tripPolicy.table(); // { owner: { active: { ... }, frozen: { "trips:write": false, ... } }, shared: { ... } }
```

`allows(relation, state, permission)` is true only when the relation's list and the state's list both hold the permission. `table()` covers relation × state × permission. A state can only list permissions the relations name, and an unknown state or permission does not compile. The types are `StatefulPolicy<Relation, State, P>` and `StatefulPolicyTable`. `Policy<Relation, P>` stays the four-field shape (`relations`, `permissions`, `allows`, `table`), so a hand-written one still type-checks. `definePolicy` returns `PolicyBuilder<Relation, P>`, a `Policy` plus `withStates`.

### Plans

A plan, such as free or paid, is a fact about the caller, so it feeds the Grant. The app builds a Grant for each request from the caller's plan, with `Grant.fromPermissions`. The state of an object goes in the stateful policy. For example, a Trip is frozen when its owner stopped paying, and the policy then drops write and share. A quota, such as five trips at most, needs a count, so the module counts inside the unit of work its write runs in.

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
  permission: "public",
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
| `failure` | no | the tool's failure schema; defaults to `failureSchemaOf(contract)`, the contract's failure plus `Forbidden`, `ApprovalDenied` and `UnitOfWorkFailed` when its gates and `transactional` add them |

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

`idempotent` and `openWorld` are required because Effect defaults `openWorld` to `true`, and an agent client reads the hint. Each MCP adapter decides them. Pass `success` when the tool returns a view of the output, and `failure` when the adapter maps the contract's errors to its own error, such as a `ToolProblem`. The handler you pass to `toLayer` then maps to those schemas. A `failure` override replaces the gate errors too, so that mapper maps `Forbidden` and `ApprovalDenied` as well.

The tool type keeps the contract's exact types: `Tool<"greet", { parameters: typeof GreetInput; success: ...; failure: ... }>`. `toTool` is typed over `Contract<Name, Input, Output, Failure>`, not over `C extends AnyContract`. The constraint form widens the input to `InputSchema`, so the tool loses its exact parameter type. An override the options type marks optional, such as `success?: typeof View`, types the schema as `typeof View | typeof Output`, because at run time it may be either one. A `NoInput` contract renders its parameters as `{"type":"object","additionalProperties":false}`.

The house plugin's `no-hand-rolled-surface` rule fails on `Tool.make` outside this package, so every MCP tool comes from a contract.

## Limits

It has `defineContract`, `implement`, `NoInput`, `toTool`, the `Grant` and `Approval` gates with their cartridges, the `CallWatch` hook with its call facts, the `UnitOfWork` slot with its SQL and memory adapters, and `definePolicy` with its `withStates`, and nothing else. A token scope does not narrow the Grant yet, and there is no CLI `--yes` or web confirm for approval. There is no registry of capabilities, and nothing turns a contract into an HTTP route or a CLI command yet. The handler takes the decoded input. Decoding raw input with the contract's schema is the adapter's job. For MCP, Effect's `McpServer` decodes it with the tool's parameters.

## Exports

`defineContract`, `implement`, `toTool`, `failureSchemaOf`, the `NoInput` schema, the `Grant`, `Approval`, `CallWatch`, `UnitOfWork`, and `CurrentUnit` services, the `CallChannel` and `CallRequestId` references, `withRequestId`, `requestIdOf`, `newRequestId`, `requestIdHeader`, `mcpChannel`, `isMcpChannel`, `maxClientNameLength`, `maxTargetIdLength`, `sqlUnitOfWork` and `memoryUnitOfWork`, the `Forbidden`, `ApprovalDenied`, `NoOpenUnit`, and `UnitOfWorkFailed` errors, `elicitationApproval`, `ApprovalForm`, `approvalMessage`, `definePolicy`, and the types `Contract`, `AnyContract`, `Annotations`, `InputSchema`, `PlainSchema`, `DefineContractOptions`, `Permission`, `PermissionDeclaration`, `GrantService`, `ApprovalService`, `CallWatchService`, `Around`, `CallFacts`, `CallKind`, `AuditDeclaration`, `AuditOptions`, `StringKeyOf`, `GrantRequirement`, `ApprovalRequirement`, `UnitOfWorkRequirement`, `GateRequirements`, `UnitOfWorkService`, `OpenUnit`, `Atomic`, `FailureSchemaOf`, `FailureOf`, `Capability`, `HandlerOf`, `Policy`, `PolicyBuilder`, `PolicyTable`, `StatefulPolicy`, `StatefulPolicyTable`, `ContractTool`, and `ToToolOptions`.
