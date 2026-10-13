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
| `newRequestId` | an `Effect<string>`: 32 random lowercase hex characters from Effect's `Random`, so a test can seed it. It is a log key, not a secret. |
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

A valid incoming id is kept as sent, so an id set by a proxy or a client in front can be followed through. Anything else is replaced. The id is not trimmed first: ` abc ` is replaced, not kept as `abc`. The id only traces a request: it grants nothing and never decides access, so a client that sends its own id can only confuse its own trail. Free text never reaches the audit, because `requestIdOf` lets only id characters through. `withRequestId` is dual: `withRequestId(effect, id)` works too. An inner `withRequestId` wins over an outer one.

### Units of work

A use-case owns the transaction, not the module. One unit of work may cover writes in several modules. `UnitOfWork` is a slot like `Grant`, with two adapters:

| Adapter | Type | Use |
| --- | --- | --- |
| `sqlUnitOfWork` | `Layer<UnitOfWork, never, SqlClient>` | Postgres: one `SqlClient.withTransaction` per unit |
| `memoryUnitOfWork` | `Layer<UnitOfWork>` | memory stores: runs the effect, and on failure runs the rollback hooks the stores registered; one unit at a time |

A use-case opens a unit in one of two ways:

1. [ ] The contract sets `transactional: true`. `implement` runs Grant, then Approval, then the handler inside `UnitOfWork.atomic`, all inside `CallWatch`. A refused call opens no unit. The flag adds `UnitOfWork` to the requirements and `UnitOfWorkFailed` to the failures. It removes `NoOpenUnit` from the implemented handler's error type and turns that invariant failure into a defect. `false`, the default, adds nothing.
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

`CurrentUnit` is a `Context.Reference` holding the open unit, `undefined` by default, so reading it adds no requirement. The SQL adapter puts the transaction connection in the fiber's context, so every statement on the same `SqlClient` inside the unit joins it. Build the module stores and `sqlUnitOfWork` from one `SqlClient` layer. Scripts, tests, and the app's server process open a unit themselves, such as a background loop that opens one unit per item: `memoryUnitOfWork` with memory stores, or `sqlUnitOfWork` with Postgres stores. `UnitOfWork.make(transaction)` builds another adapter from a function that wraps an effect in a transaction.

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

Do not use `Schema.Struct({})` for this. Effect renders it to JSON Schema as `{"not":{"type":"null"}}`, with no `type`. An MCP tool's input schema must have `"type": "object"`, so Effect's `McpServer` fails to list every tool with `SchemaError: Missing key at ["type"]`. `NoInput` is `Schema.Record(Schema.String, Schema.Never)`, the same shape as Effect's `Tool.EmptyParams`. It renders as `{"type":"object","additionalProperties":false}`, so an MCP tool can use `contract.input` as its `parameters` as is. Checked with `effect` 4.0.3.

## An input with several shapes

Some actions take one of a few inputs, such as "find a booking by its id or by its guest". Give them a `Schema.Union` of Structs, one per shape, with a tag field each:

```ts
import { Effect, Schema } from "effect";
import { defineContract, implement } from "@house-rules/capability";

const FindInput = Schema.Union([
  Schema.Struct({ by: Schema.Literal("id"), bookingId: Schema.String }),
  Schema.Struct({ by: Schema.Literal("guest"), guest: Schema.String }),
]);

const findContract = defineContract("find_booking", {
  description: "Find a booking by its id or by its guest.",
  input: FindInput,
  output: Schema.String,
  failure: Schema.Never,
  permission: "bookings:read",
});

const find = implement(findContract, (input) =>
  Effect.succeed(input.by === "id" ? input.bookingId : input.guest),
);
```

The handler gets one decoded member, so `input.by` narrows it. Every member must be a Struct. `audit.target` may name only a string field that every member has.

An MCP tool cannot take a Union: Effect's `McpServer` needs an object at the root of a tool's input schema. So `toTool` splits the tool's parameters into two jobs.

1. The gate is what `McpServer` decodes with. It checks only the outer shape: the input is an object, and every key belongs to some member. A key no member takes fails with `InvalidParams`. The gate checks no value and requires no key, and it hands the raw arguments on unchanged. They then decode once through the real Union, which alone decides what is valid, which keys are required, and what each value becomes. So for MCP arguments that are JSON objects using only declared keys, the gate never refuses an input the Union takes and never changes one, whatever codecs, defaults or getters the members use. A key no member declares is always refused, even when a loose member such as an empty `Schema.Struct({})` would take it. A value one member would trim or parse never reaches another member changed. The promise covers JSON objects with declared keys only. Effect's empty `Schema.Struct({})` takes any value but `null` and `undefined`, such as `1` or `[]`, and the gate still refuses those, because MCP arguments are never anything but an object.
2. The advertisement is the JSON Schema the model sees: one merged object. Each key shows its wire type, the encoded side, and a key two members type differently shows the Union of both. The tag becomes an enum, here `"id" | "guest"`. The object is closed: `"additionalProperties": false`. A key's requiredness errs strict: a key is optional only when some member leaves it out, or some member is optional on both sides for that key with nothing in its decoding, its Struct or the Union that could refuse a missing key.

So a key a member marks `optionalKey(Schema.String)` or `optional(Schema.FiniteFromString)` is optional. Every other key every member has is required, even when the action would take it missing: a decoding default such as `withDecodingDefaultKey`, `OptionFromOptionalKey`, a `transformOptional` or `SchemaGetter.required()` getter, a `Schema.suspend` field, and a check on the member Struct or on the Union all make it required. The advertisement may therefore ask for more than the Union needs. A key some member leaves out stays optional, because one JSON object cannot tie a key to a tag. Any other key is never called optional when the Union refuses to go without it, and for a JSON object with declared keys the gate never refuses what the Union takes, because the Union decides. So `{ "by": "guest" }` passes the gate, fits no member, and fails like any other invalid input: the MCP client gets an `InvalidParams` error, and the handler does not run.

The gate is `Schema.Any` with one filter. The filter's `toJsonSchema` hook returns the advertisement, compiled from its `representation.schemas`, the way `Schema.isPropertyNames` does. `Schema.Any` keeps the filter through `Schema.toCodecJson`, where `Schema.Unknown` would not. Checked with `effect` 4.0.3.

## Install in another app

Install it from npm at an exact version:

```json
{
  "dependencies": {
    "@house-rules/capability": "0.15.0",
    "effect": "4.0.3"
  }
}
```

1. [ ] Pin `effect` to the same exact version this package names in `peerDependencies`. It is an exact peer, and the handler types come from that copy of `effect`. If the app installs `@effect/platform-node`, also declare `@effect/platform-node-shared` as an exact direct dependency at the same version, now `4.0.3`.
2. [ ] Stable 4.0.3 needs no release-age exception. For a future version under a day old, wait or get approval for an exact-version `minimumReleaseAgeExclude` entry. Remove the old RC entries.
3. [ ] The package ships built JavaScript and `.d.ts` files in `dist/`. Plain `node` loads it, and a bundler such as Next's needs no `transpilePackages` entry for it. Browser code imports `@house-rules/capability/contract`.
4. [ ] Use TypeScript 7 or 6 with `module` and `moduleResolution` set to `NodeNext`, or `Bundler` for UI code, and `skipLibCheck: true`. It is tested with TypeScript 7.0.2. Or extend `@house-rules/rules/tsconfig/effect.json`, installed as [the root README](../../README.md#using-the-rules-in-another-app) shows. Its Effect diagnostics run only after `pnpm exec effect-tsgo patch` from `@effect/tsgo`, as this repo's `prepare` script does.
5. [ ] The usage example is a test, so it needs two dev dependencies, pinned exactly: `"@effect/vitest": "4.0.3"` and `"vitest": "5.0.1"` (the versions this repo uses).
6. [ ] To upgrade, change the version and run `pnpm install`. An app that still pins a Git SHA moves as [the root README](../../README.md#upgrading-from-a-git-sha-pin) shows.

## An MCP tool from a contract

`toTool(contract, options)` builds an `effect/ai` `Tool` from a contract, so an MCP adapter does not write the tool by hand. The contract gives the name, the description, the parameters (`contract.input`, or the merged object of a Union input, as [An input with several shapes](#an-input-with-several-shapes) shows), and the `Tool.Readonly` and `Tool.Destructive` annotations. Every tool is `Tool.Strict`, so `McpServer` rejects a key the input does not take with `InvalidParams` instead of dropping it. This is new in 0.11.0 and breaks callers that sent extra keys; see [Upgrading to 0.11.0](#upgrading-to-0110). The options carry what only MCP needs:

| Option | Required | Becomes |
| --- | --- | --- |
| `title` | yes | `Tool.Title` |
| `idempotent` | yes | `Tool.Idempotent` |
| `openWorld` | yes | `Tool.OpenWorld` |
| `success` | no | the tool's success schema; defaults to `contract.output` |
| `failure` | no | the tool's failure schema; defaults to `failureSchemaOf(contract)`, the contract's failure plus `Forbidden`, `ApprovalDenied` and `UnitOfWorkFailed` when its gates and `transactional` add them |

```ts
import { Toolkit } from "effect/ai";
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

The tool type keeps the contract's exact types: `Tool<"greet", { parameters: typeof GreetInput; success: ...; failure: ... }>`. `toTool` is typed over `Contract<Name, Input, Output, Failure>`, not over `C extends AnyContract`. The constraint form widens the input to `InputSchema`, so the tool loses its exact parameter type. An override the options type marks optional, such as `success?: typeof View`, types the schema as `typeof View | typeof Output`, because at run time it may be either one. A `NoInput` contract renders its parameters as `{"type":"object","additionalProperties":false}`. A Union contract types its parameters as `Schema.decodeTo<Input, MergedParameters<Members>>`: its `Type` is the Union's, so the handler you pass to `toLayer` gets one member, and its `Encoded` is the merged wire shape, built from the members' encoded types. A key in it is optional when some member lacks it or leaves it optional on the wire. This static type is not the JSON advertisement: the advertisement has its own, stricter requiredness, so a key with a decoding default is optional in `Encoded` but required in the JSON. At run time the gate takes any value per key, so this type describes what a caller may send, not what the gate checks. `ToolParameters<Input>` names that type, and is `Input` itself for a Struct or `NoInput`.

The house plugin's `no-hand-rolled-surface` rule fails on `Tool.make` outside this package, so every MCP tool comes from a contract.

## Delivery

Delivery mounts capabilities on a host. The seam is the Web fetch standard: the host hands over a `Request` and gets a `Response`. Next route files, the House Rules Node Host, Bun, Hono and Workers all speak it. For Node apps, install `@house-rules/node-host` and call `serve(api, { port, onClose: () => api.dispose().then(() => app.dispose()), handleSignals: true })` in `src/main.ts`, an `appEntryFiles` entry. `src/server/` holds background loops, not the Host call. Its guide is `packages/node-host/README.md` in the House Rules repo. It streams the fetch handler without an app import of `node:http`. A Next app already has a Host and does not need it. React server code skips HTTP and calls the capability in-process with `call`.

```text
 host: Next route | Node Host | Bun | Worker           React server component
        | Request                                       | headers(), input
        v                                               v
 toFetchHandler / toMcpHandler                        call(app, capability, input, incoming)
   1 request id (x-request-id, echoed)
   2 CSRF: a write with a Cookie from another origin -> 403
   3 caller(incoming) -> Context<Viewer | Grant | ...>  or Refused -> its status + challenge
   4 decode input with contract.input                   or InputInvalid -> 400
        v
 composition: the app layer (built on first use, again after a failed build), the caller, the views
        v
 capability.handler: CallWatch -> Grant -> Approval -> UnitOfWork -> handler
        v value | typed failure
 encode output | views[tag](error, caller) -> Response, MCP tool result, or Outcome
```

```ts
import { composition, route, toFetchHandler, toMcpHandler, tool, call, once } from "@house-rules/capability";

// The one composition root: the layer is built once and shared by every adapter.
export const app = composition({ layer: appLayer, caller: sessionCaller, views });

export const api = toFetchHandler(app, {
  prefix: "/api",
  caller: bearerCaller,
  routes: [
    route(showBooking, "GET /bookings/:id"), // path params and query, decoded from strings
    route(findBookings), // default: POST /api/find_bookings, JSON body
  ],
});

// MCP sessions live in memory, so make the handler once per process, even across Next dev reloads.
export const mcp = once("mcp", () =>
  toMcpHandler(app, {
    path: "/mcp",
    name: "hosti",
    version: "1.0.0",
    caller: oauthCaller,
    tools: [tool(showBooking, { title: "Show a booking", idempotent: true, openWorld: false })],
  }),
);

// React server code: no HTTP hop.
const result = await call(app, showBooking, { id }, { headers: await headers(), url });
// { ok: true, value } | { ok: false, error, view }
```

1. [ ] **Composition.** `composition({ layer, caller, views })` builds one `ManagedRuntime` over the layer. `call`, every fetch handler and every MCP handler read the same built services, so they share one pool. `app.dispose()` closes it. The layer's error type stays in the composition, `Composition<A, C, Views, E>`, so a layer that fails with a tagged error, such as a database that is down, answers that error's view on every adapter: `toFetchHandler` sends its status and body, `toMcpHandler` refuses the HTTP request with them before `McpServer` runs, and `call` resolves to `{ ok: false, error, view }`. None of them rejects. A layer that dies, or fails with an error that has no tag, is the fixed 500. Each failure is logged with the request id. A failed build is not kept: the next use builds the layer again, so a 503 clears when the database comes back, with no restart. Concurrent first requests share one build, and a build that succeeds is kept. `app.runtime` is the current runtime, a fresh one after a failed build. Each request runs as a fiber of that runtime once the layer is built. `app.dispose()` is final: it interrupts every request still running, then closes the layer's resources, so no request runs on a closed pool. After it, nothing builds the layer again, not even after a failed build. A request that arrives later, or waits on a build when dispose runs, answers `CompositionClosed`, whose default view is 503 `unavailable` `The app is shutting down.`, on all three adapters. A second `dispose()` returns the same finished shutdown. The layer starts cold: the first request builds it, even one that a refusal then turns away, such as a 401 from the caller. Only the CSRF check runs before the build. To keep a refused request from doing startup work, warm the app at startup, for example with `app.runtime.runPromise(Effect.void)`.
2. [ ] **Caller.** `Caller<C, R>` is `(incoming: { headers, url }) => Effect<Context<C>, Refused, R>`. It runs with the app's services, so it can ask an identity module who this is. It returns the per-request services, usually `Viewer` and `Grant`. `Refused` carries a `status`, a `code`, a `message` and an optional `challenge`, which goes out as `WWW-Authenticate`. Each adapter may take its own caller; the composition's is the default.
3. [ ] **Input.** The adapter decodes the whole input once, with `contract.input`, and the handler gets the decoded type. A path param on a write, and an MCP call's arguments, pass a field or toolkit decode first, so a schema filter may run more than once. A GET takes path params plus query, decoded with the StringTree codec, so `"5"` becomes `5`. A write (POST, PUT, PATCH, DELETE) takes the JSON body plus path params; a path param is decoded through its field's codec first. A key given twice, a JSON member given twice (even spelled with an escape), a key the input does not take (`__proto__` too), or a query key on a write is a 400. An array field in a GET query is the one exception to "once": see [The query](#the-query). A write body must be valid UTF-8; a stray byte is a 400 `The body is not valid UTF-8.`, never a replacement character. `InputInvalid` names the capability, the field and the issue, and never quotes the value. `call` decodes its input too, because a server action's input is untrusted.
4. [ ] **Views.** A view is `{ status, body, headers?, code? }`; `code` is the public failure code it opts in to send, see [Single-page apps](#single-page-apps). The app keeps one table, failure tag to `(error, caller) => View`. Defaults cover House Rules' own tags; an app or adapter view replaces one by tag. A defect, or an error with no view, is a 500 `internal_error`, logged with the request id. So is a view that throws, an output the contract cannot encode, and any other defect while the adapter answers. Status 500 is kept for defects. `problem` and `problemView` refuse a literal 500 at compile time. A view that answers 500 anyway, say from a status held in a variable, sends the same `internal_error` body, and its own body goes to the log. A view may still pick another 5xx, such as 503 `unavailable`, with the body its author wrote. MCP uses the same table: the body becomes an `isError` tool result and the status is dropped.
5. [ ] **Approval per channel.** `toFetchHandler` fails closed (`Approval.denyAll`), `toMcpHandler` asks the human with `elicitationApproval`, and `call` uses `Approval.allowAll`, because a click in the app is the human's yes. Each takes an `approval` option. The adapter's Approval always wins over one a caller returns, so a caller cannot switch off the human's yes by mistake. To let the caller's Approval decide, say so by name: `approval: "fromCaller"`. The adapter's default still applies when the caller returns none.
6. [ ] **Body limit.** A write body over 1 MB (`defaultMaxBodyBytes`) is a 413 `body_too_large`, checked on `content-length` and again while it streams. Set `maxBodyBytes` to change it.
7. [ ] **Success body.** The success body is the contract's output, encoded with its JSON codec, with `content-type: application/json` and no charset (JSON has none). There is no success view. Keys the output schema does not declare are dropped, so a handler cannot leak them. The status is the route's: `route(cap, at, { status: 201 })`. Paging goes in the body, such as `{ items, next }`, not in a `Link` header. MCP encodes the output the same way and sends it as `structuredContent`. `call` does not encode: it returns the handler's typed value as is, undeclared keys included, because it never leaves the process.

| Tag | Default view |
| --- | --- |
| `Refused` | its `status` and `code`; `WWW-Authenticate` when it has a `challenge` |
| `InputInvalid` | 400 `invalid_input`, with `field`; the error also carries `capabilityName` and `issue` for an app view |
| `Forbidden` | 403 `forbidden` |
| `ApprovalDenied` | 403 `approval_denied` |
| `UnitOfWorkFailed` | 503 `unavailable` |
| `CompositionClosed` | 503 `unavailable`, `The app is shutting down.` |
| `NoOpenUnit`, a defect, no view | 500 `internal_error` |

### Input errors

`InputInvalid` has four fields. An app view can word its own message from them:

| Field | Value |
| --- | --- |
| `capabilityName` | the contract's name, such as `search_tasks` |
| `field` | the field's path, such as `status` or `positions.0.x`; `body` when the body itself is wrong; `input` when the key cannot be named safely |
| `issue` | `unexpected` (a key the input does not take, or a query key on a write), `missing`, `invalid` (a value the field refuses, or a body that is not JSON, not an object, not UTF-8, or unreadable), `repeated` (a key given twice) |
| `message` | the default text, such as `status is not valid.` or `Give q once.` |

```ts
const views = {
  InputInvalid: (e: InputInvalid) =>
    problem(422, "invalid_input",
      e.issue === "invalid" || e.issue === "missing"
        ? (MESSAGES[e.capabilityName]?.[e.field] ?? e.message)
        : e.message),
};
```

The default view's body stays `{ code, message, field }`. `decodeInput(contract, raw, source)` names `contract.name` too.

### The query

A GET reads its input from the path and the query, decoded with the StringTree codec. The field's StringTree side decides how a key is read:

| Field | Query | Notes |
| --- | --- | --- |
| a string, number or literal | `k=v`, once | `5` decodes to `5` |
| `Schema.Boolean` | `k=true` or `k=false` | `1`, `0` and an empty value are invalid |
| an array of scalars | `k=a&k=b`, one key per item, in order; `k=a` is `[a]` | OpenAPI `style: form`, `explode: true` |
| optional | leave the key out | an empty array sends no key |
| with a default | leave the key out | write the default in the contract: `Schema.withDecodingDefaultKey(Effect.succeed(v))`; it works in the JSON codec too |
| anything else, such as a struct or a nullable array | not a GET field | give the contract a write route |

A key is a list only when every Union member that has it reads a list. Still refused: a repeat on a field that is not a list (`Give x once.`), a key the input does not take, a path key in the query, and a comma list. A comma is data, so `status=a,b` is one item, `"a,b"`.

### A missing view is a type error

`toFetchHandler`, `toMcpHandler` and `call` check each mounted capability against the app at compile time. Every failure tag needs a view in the defaults, the composition's `views`, or the adapter's `views`. So does every tag in the layer's error type: `composition()` fails `tsc` with `missingViews` when the layer can fail with a tag that has no view there, and each adapter checks it again against its own views. A view keyed by a tag must take that tag's error. Every service the handler needs must come from the app layer, the caller or the adapter. A gap fails `tsc` and names it:

```text
Property 'missingViews' is missing in type '{ routes: ... }'
  but required in type '{ readonly missingViews: "BookingNotFound"; }'.
```

The same check reports `wrongViews` and `missingServices`.

### CSRF

A browser sends cookies with a cross-site write by itself, whoever the caller is. So `toFetchHandler` checks every write (POST, PUT, PATCH, DELETE) that carries a `Cookie` header, even an empty one, and even one that also has a bearer token. A write whose `Origin` does not match the app's origin is a 403 `cross_origin` before the app layer builds or the caller runs. Without `Origin`, the `Referer`'s origin decides; with neither, the write is refused. An opaque source, `Origin: null` or a `data:` Referer, is always refused. The app's origin is the request URL's origin, or the `origins` list you pass to `toFetchHandler`. Set `origins` when a proxy changes the host or scheme. Set it for local and internal apps too, and restrict Host at their proxy or listener to guard against DNS rebinding. Each entry must be a plain `http(s)` origin, such as `https://app.example`, with no path; anything else, `"null"` included, throws when the handler is built. A write with no `Cookie` is not checked: no session rides along cross-site. A route opts out only with a written reason:

```ts
route(stripeWebhook, "POST /hooks/stripe", {
  csrf: { skip: true, reason: "Stripe signs the body; no browser sends it." },
});
```

An empty reason throws when the route is built.

### One router per handler

Each `toFetchHandler` and `toMcpHandler` builds its own router. A fetch handler answers only its own routes, so it never serves MCP, and two handlers on one composition may mount the same path. They still share the app's services through the composition.

### Request ids

Every adapter takes `x-request-id` when it is safe, or makes a fresh one of 32 lowercase hex characters, and echoes it on the response. MCP keeps one id per HTTP request: the caller, the tool's `CallRequestId`, the logs and the response header all carry it.

## Single-page apps

A single-page app calls the same routes over HTTP. `@house-rules/capability/contract` is the browser-safe entry: `defineContract`, `endpoint`, `toHttpClient`, the gate errors and the types, with no SQL, no MCP server and no router. A module puts the contracts a browser needs in its own contract entry, `src/contract.ts`, exported as `"./contract"`. The rule `contract-entry-is-browser-safe` fails the check when that file reaches an adapter, a facade, a storage port, a `node:` module or a driver.

```ts
// packages/bookings/src/booking/show-booking.ts, re-exported by src/contract.ts
export const showBookingContract = defineContract("show_booking", { ... });

// apps/api/src/delivery/http/endpoints.ts: read by the server and the browser
export const bookingEndpoints = {
  showBooking: endpoint(showBookingContract, "GET /bookings/:id"),
} as const;

// server: the route takes the endpoint, and throws when it names another contract
route(showBooking, bookingEndpoints.showBooking);

// browser
const client = toHttpClient([bookingEndpoints.showBooking], { prefix: "/api" });
const booking = yield* client.show_booking({ id }); // Effect<Booking, HttpFailure | HttpClientError, HttpClient>
```

- **Same wire rules.** A GET sends the path values in the path and every other field as one query value, encoded with the StringTree codec the fetch handler decodes with. An array field goes out as one key per item, `status=a&status=b`, and an empty array as no key, as [The query](#the-query) says. A write sends the JSON body without the path keys, because the handler refuses a key given twice. A path value, or a GET field that encodes to neither one string nor a list of strings, such as a struct, is a defect: give that contract a write route.
- **Types from the contract.** The client's keys are the contract names. Each call takes the input's `Type`, returns the output's `Type`, and needs `HttpClient` from `effect/http`. A wrong input, a wrong output, or a failure code the endpoint does not declare is a `tsc` error. In the browser, provide `FetchHttpClient.layer`. Outside one, prepend an origin with `HttpClient.mapRequest(HttpClientRequest.prependUrl(origin))`.
- **Failures send nothing by default.** The server sends the view's status and body, never the error. A view may hide one failure behind another, such as `Forbidden` behind a 404 `not_found`, and nothing on the wire tells them apart. To give the client a code, two sides opt in. The view exposes it: `problemView(404, "not_found", message, { exposeCode: true })`, or a hand-written view that returns `code`. The endpoint declares it: `endpoint(contract, "GET /bookings/:id", { codes: ["not_found"] })`. Only then does a 4xx answer carry `x-failure-code: not_found`. A code the endpoint does not declare, a 5xx, or a code on a route mounted from a string never goes out as `x-failure-code`, and a view's own `x-failure-code` header is dropped. The double opt-in gates only that typed header, the one the client turns into a typed failure. The body is the view's: a code its author writes into a 4xx body goes out as written, so write only what the client may see.
- **The client checks codes.** It fails with `HttpFailure { code, status, body }`. `code` is typed as the endpoint's declared codes plus `Unknown`. A 4xx whose header names a declared code gets that code. Anything else is `Unknown`: no header, a code the endpoint does not declare, any 5xx, or an output that does not decode. `status` and `body` still say what the view sent, such as a 401 `session_invalid`. A network error stays an `HttpClientError`. The client never decodes the real error, because its fields may hold what the view hides, such as a defect cause or a permission name.
- **Cookies and CSRF.** `FetchHttpClient` uses `fetch`, which sends same-origin cookies by default. Set `FetchHttpClient.RequestInit` for anything else. The browser adds `Origin` to every POST, PUT, PATCH and DELETE, and to cross-origin requests, so the CSRF check passes from the app's own origin and refuses another site's write with a 403. Script cannot set `Origin`, so the client never does.
- **OpenAPI.** `toOpenApi(routes, { title, version, prefix, views, security })` returns an OpenAPI 3.1 document. Inputs and outputs come from the contracts through Effect's JSON Schema, with shared, named schemas under `components.schemas`. A named input is followed before it is split. A GET Struct input becomes path and query parameters, an array field a `style: form`, `explode: true` parameter, and a GET Union input becomes one exploded `input` query object, required when every member requires a field. A write gets a JSON body without the path fields. A failure goes under the status its view always answers: a `problemView(404, "not_found", message)` view, or a default view, says it. A view that picks its status per error goes under `default`, as do refusals and the 500. The document names no internal tag. A response lists the `x-failure-code` header only for codes the endpoint declares: under the status of the `problemView` that exposes it, or under `default`. The `operationId` is the contract's name; a contract on two endpoints gets its method and path added, and a clash fails the build. `security: { schemes, require? }` adds the schemes; a `"public"` contract drops them. Effect's `OpenApi.fromApi` needs an `HttpApi`, which wants the HTTP status on the error schema and four input schemas, so House Rules writes the document itself. The tests check its shape; no OpenAPI 3.1 validator runs on it yet.

## Upgrading to 0.15.0

Pin `effect`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/sql-pg` and `@effect/vitest` to 4.0.3. Apps that install `@effect/platform-node` declare the shared package directly too. The Effect peer is exact. Move migrations to 0.3.0, call-audit to 0.4.0 and rules to 0.16.2 in the same change. Remove the old RC release-age exceptions. Add an exact-version exception only for a release under a day old.

Stable Effect drops the `unstable/` import prefix. Use `effect/ai`, `effect/http`, `effect/http-api`, `effect/rpc` and `effect/sql`. `Encoding.encodeHex` is now `Hex.encode` from `effect/encoding`. `Schema.Int` advertises safe-integer bounds in JSON Schema, so exact OpenAPI assertions include its `minimum` and `maximum`.

A contract with `transactional: true` no longer exposes `NoOpenUnit` in its implemented handler's error type. Module writes may still fail with it; `implement` turns that impossible failure into a defect inside the unit, and rolls back the work. Delete hand-written `catchTag("NoOpenUnit", ...)` catches inside transactional handlers. A `catchTag("NoOpenUnit", ...)` on the transactional capability's `.handler(...)` result now fails to compile, so delete that catch too. This failure is a defect, not a checked error: HTTP answers 500 `internal_error`, and call-audit records outcome `defect`. Remove `NoOpenUnit` from that contract's failure schema too if it was listed only for those writes. A non-transactional handler, or a direct `UnitOfWork.atomic` call, keeps the typed error.

A fresh install of Node platform rc.117 could pull stable `platform-node-shared`, whose process imports do not exist in RC Effect. The packed-consumer check now installs all tarballs plus stable Node platform without a lockfile, then type-checks and runs Node services with a transactional handler.

## Upgrading to 0.14.0

0.14.0 breaks five things:

1. [ ] **`InputInvalid` has two new required fields**, `capabilityName` and `issue`. Code that builds one by hand adds both. A view that reads only `field` and `message` keeps working, and the default body is unchanged.
2. [ ] **A layer error goes through the views.** `Composition` has a fourth type parameter, the layer's error type, which defaults to `never`. A layer that can fail with a tagged error now needs a view for that tag at `composition()`, or `tsc` fails with `missingViews`. Add one, such as `DbUnavailable: problemView(503, "unavailable", () => "Try again shortly.")`. At run time a failed build answers that view where it answered 500, `call` resolves where it rejected, and the MCP handler answers where it rejected. `call`'s `Outcome` error type now includes the layer error. Code that caught a rejected `call` can drop the catch.
3. [ ] **A failed build is retried.** The next use builds the layer again, where before the failure stayed until a restart. `app.runtime` is a getter: read it each time, do not keep it.
4. [ ] **A GET reads arrays.** An array field now takes a repeated key, and one key is a one-item list; before, both were 400s. `toHttpClient` sends such a field as repeated keys, where it died. OpenAPI marks the parameter `style: form`, `explode: true`.
5. [ ] **`dispose()` is final.** After `app.dispose()`, `call` resolves to `{ ok: false, error: CompositionClosed, view }` where it rejected, and both handlers answer its 503 where they answered 500. Nothing rebuilds the layer after dispose. `Outcome`'s error type now includes `CompositionClosed`, and `defaultViews` has its view, so an exhaustive switch over the error adds a case.

A fresh request id still comes from the app: on a built app, `call` and MCP make it inside the app runtime, so a `Random` the layer provides seeds it, as in 0.13. When the layer did not build, or after dispose, the id comes from Effect's default `Random`. `toFetchHandler` makes its id before it reads the layer, with the default `Random`, as before.

Two stricter checks: a write body that is not valid UTF-8 is a 400, where it decoded with replacement characters; and an MCP server that rejects, such as for a tool schema it cannot list, is the fixed 500 with the request id, where the handler rejected. `@house-rules/call-audit` 0.3.0 peers on this version.

## Upgrading to 0.13.0

Nothing breaks for a route written as a string. `route(capability, at)` now also takes an `endpoint`, and it throws at mount on an unknown method. `Route` gained `contract` and `codes`, so code that builds a `Route` by hand, not through `route()`, must add both. A failure response sends no tag; a view and an endpoint opt in to an `x-failure-code` together. `defaultViews` entries with a fixed status carry it as `.status`, and a `problemView` with `exposeCode` carries `.code`, for OpenAPI. The stack's example moved `showBookingContract` from its use-case to `@hosti/bookings/contract`, so a browser can import it.

## Upgrading to 0.11.0

0.11.0 is a breaking change for MCP tools. Every `toTool` tool, a Struct one too, is now `Tool.Strict`:

1. An MCP call with a key the input does not take, at the root or inside a nested Struct, now fails with `InvalidParams`. Before, `McpServer` dropped the key and ran the handler. A client that sends extra metadata, or resends a whole saved record with fields the input lacks, now gets an error. Send only the keys the input takes.
2. A tool's JSON schema now says `"additionalProperties": false` where it said `true`. A test that compares a tool's advertised schema exactly must update that value. Trippy has three such assertions.

A Union input is new and changes nothing for a Struct input's types.

## Limits

It has `defineContract`, `implement`, `NoInput`, `toTool`, the `Grant` and `Approval` gates with their cartridges, the `CallWatch` hook with its call facts, the `UnitOfWork` slot with its SQL and memory adapters, and `definePolicy` with its `withStates`, and nothing else. A token scope does not narrow the Grant yet, and there is no CLI `--yes` or web confirm for approval. There is no registry of capabilities and no CLI command from a contract. The typed SPA client and OpenAPI come from House Rules' own projection, not Effect's `HttpApi`. Delivery has no streaming, file upload or rate limit, and plain HTTP has no confirm flow for a write that needs approval. The handler takes the decoded input. Decoding raw input with the contract's schema is the adapter's job; the delivery adapters do it for you.

## Exports

Delivery: `composition`, `once`, `call`, `toFetchHandler`, `route`, `toMcpHandler`, `tool`, `decodeInput`, `defaultViews`, `defaultMaxBodyBytes`, `problem`, `problemView`, `toOpenApi`, the `Refused` and `InputInvalid` errors, and the types `Composition`, `Caller`, `Incoming`, `View`, `ViewFn`, `ViewTable`, `CallerContext`, `DefaultViewTag`, `ViewsCheck`, `MountCheck`, `ServicesCheck`, `Mountable`, `Outcome`, `ApprovalOption`, `CallOptions`, `Route`, `RouteOptions`, `CsrfOptOut`, `Method`, `FetchHandler`, `FetchHandlerOptions`, `McpTool`, `McpToolOptions`, `McpHandlerOptions`, `InputSource`, `InputIssue`, `ProblemViewOptions`, `StaticStatus`, `OpenApiDocument`, `OpenApiOptions`, `OpenApiSecurity`, and `OpenApiSecurityScheme`.

Client, also from `@house-rules/capability/contract`: `endpoint`, `toHttpClient`, `failureCodeHeader`, the `HttpFailure` error, and the types `Endpoint`, `EndpointOptions`, `EndpointShape`, `HttpClientOf`, `HttpClientOptions`, `ClientCall`, `ClientFailureCode` and `HttpFailureOf`. The contract entry also exports `defineContract`, `failureSchemaOf`, `NoInput`, the `Forbidden`, `ApprovalDenied`, `UnitOfWorkFailed`, `InputInvalid` and `Refused` errors, the `InputIssue` type, and the contract and permission types.

The rest: `defineContract`, `implement`, `toTool`, `failureSchemaOf`, the `NoInput` schema, the `Grant`, `Approval`, `CallWatch`, `UnitOfWork`, and `CurrentUnit` services, the `CallChannel` and `CallRequestId` references, `withRequestId`, `requestIdOf`, `newRequestId`, `requestIdHeader`, `mcpChannel`, `isMcpChannel`, `maxClientNameLength`, `maxTargetIdLength`, `sqlUnitOfWork` and `memoryUnitOfWork`, the `Forbidden`, `ApprovalDenied`, `NoOpenUnit`, and `UnitOfWorkFailed` errors, `elicitationApproval`, `ApprovalForm`, `approvalMessage`, `definePolicy`, and the types `Contract`, `AnyContract`, `Annotations`, `InputSchema`, `StructInput`, `UnionInput`, `PlainSchema`, `DefineContractOptions`, `Permission`, `PermissionDeclaration`, `GrantService`, `ApprovalService`, `CallWatchService`, `Around`, `CallFacts`, `CallKind`, `AuditDeclaration`, `AuditOptions`, `StringKeyOf`, `GrantRequirement`, `ApprovalRequirement`, `UnitOfWorkRequirement`, `GateRequirements`, `UnitOfWorkService`, `OpenUnit`, `Atomic`, `FailureSchemaOf`, `FailureOf`, `Capability`, `HandlerOf`, `Policy`, `PolicyBuilder`, `PolicyTable`, `StatefulPolicy`, `StatefulPolicyTable`, `ContractTool`, `ToToolOptions`, `ToolParameters`, and `MergedParameters`.
