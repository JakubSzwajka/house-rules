import { featureFixture } from "./feature-fixtures.ts";
import { defineOperation } from "@house-rules/domain";
import { bindFixture } from "./execution-fixtures.ts";
import { httpFixture, mcpFixture } from "./router-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { call, decodeInput, type InputInvalid, endpoint } from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { callMcpTool, openMcpSession } from "./delivery-mcp-client.ts";

const Status = Schema.Literals(["todo", "doing", "done"]);

const listThings = bindFixture(
  featureFixture(
    defineOperation("list_things", {
      description: "List things.",
      input: Schema.Struct({ q: Schema.String, limit: Schema.optionalKey(Schema.Int) }),
      output: Schema.Struct({ q: Schema.String }),
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  ({ q }) => Effect.succeed({ q }),
);

const moveThing = bindFixture(
  featureFixture(
    defineOperation("move_thing", {
      description: "Move a thing.",
      input: Schema.Struct({ id: Schema.Int, to: Status }),
      output: Schema.Struct({ id: Schema.Int, to: Status }),
      failure: Schema.Never,
      permission: null,
    }),
  ),
  (input) => Effect.succeed(input),
);

let nameChecks = 0;
const validName = Schema.makeFilter<string>((name) => {
  nameChecks += 1;
  return name !== "bad";
});

const pickThing = bindFixture(
  featureFixture(
    defineOperation("pick_thing", {
      description: "Pick a thing by name.",
      input: Schema.Struct({ name: Schema.String.check(validName) }),
      output: Schema.Struct({ name: Schema.String }),
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  ({ name }) => Effect.succeed({ name }),
);

const exposed = {
  InputInvalid: (error: InputInvalid) =>
    `${error.feature}|${error.field}|${error.issue}|${error.message}`,
};
const fixture = httpFixture([listThings, moveThing], {
  endpoints: [endpoint(listThings, "GET /things"), endpoint(moveThing, "POST /things/:id/move")],
  overrides: exposed,
});
const plain = httpFixture([listThings], { endpoints: [endpoint(listThings, "GET /things")] });
const mcpApp = mcpFixture([pickThing], {
  tools: [{ feature: pickThing, title: "Pick", idempotent: true, openWorld: false }],
});
const app = fixture.app;
const http = fixture.handler;
const plainHttp = plain.handler;
const mcp = mcpApp.handler;
afterAll(() => Promise.all([fixture.dispose(), plain.dispose(), mcpApp.dispose()]));

const get = (path: string) => answer(http, webRequest(`https://app.example${path}`));

const post = (path: string, body: NonNullable<RequestInit["body"]>) =>
  answer(
    http,
    webRequest(`https://app.example${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );

const fault = (feature: string, field: string, issue: string, message: string) => ({
  status: 400,
  body: { error: { code: "invalid", message: `${feature}|${field}|${issue}|${message}` } },
});

const outcomeOf = (r: Readonly<{ status: number; body: unknown }>) => ({
  status: r.status,
  body: r.body,
});

it.effect("query: an unknown key is unexpected, a missing one missing, a bad one invalid", () =>
  Effect.gen(function* queryIssues() {
    expect(outcomeOf(yield* get("/things?q=a&nope=1"))).toEqual(
      fault("list_things", "nope", "unexpected", "nope is not a field here."),
    );
    expect(outcomeOf(yield* get("/things"))).toEqual(
      fault("list_things", "q", "missing", "q is required."),
    );
    expect(outcomeOf(yield* get("/things?q=a&limit=five"))).toEqual(
      fault("list_things", "limit", "invalid", "limit is not valid."),
    );
  }),
);

it.effect("query: a key given twice is repeated, never an invalid value", () =>
  Effect.gen(function* queryRepeated() {
    expect(outcomeOf(yield* get("/things?q=a&q=b"))).toEqual(
      fault("list_things", "q", "repeated", "Give q once."),
    );
  }),
);

it.effect("body: a fault in the body itself is field body, issue invalid", () =>
  Effect.gen(function* bodyFaults() {
    expect(outcomeOf(yield* post("/things/1/move", "{"))).toEqual(
      fault("move_thing", "body", "invalid", "The body is not valid JSON."),
    );
    expect(outcomeOf(yield* post("/things/1/move", "[]"))).toEqual(
      fault("move_thing", "body", "invalid", "The body must be a JSON object."),
    );
  }),
);

it.effect("body: unknown, missing, bad and repeated members", () =>
  Effect.gen(function* bodyMembers() {
    expect(outcomeOf(yield* post("/things/1/move", '{"to":"todo","extra":1}'))).toEqual(
      fault("move_thing", "extra", "unexpected", "extra is not a field here."),
    );
    expect(outcomeOf(yield* post("/things/1/move", "{}"))).toEqual(
      fault("move_thing", "to", "missing", "to is required."),
    );
    expect(outcomeOf(yield* post("/things/1/move", '{"to":"gone"}'))).toEqual(
      fault("move_thing", "to", "invalid", "to is not valid."),
    );
    expect(outcomeOf(yield* post("/things/1/move", '{"to":"todo","to":"done"}'))).toEqual(
      fault("move_thing", "to", "repeated", "Give to once."),
    );
  }),
);

it.effect("write: a query key is unexpected, a path key in the body repeated", () =>
  Effect.gen(function* writeKeys() {
    expect(outcomeOf(yield* post("/things/1/move?to=todo", "{}"))).toEqual(
      fault("move_thing", "to", "unexpected", "to is not a field here."),
    );
    expect(outcomeOf(yield* post("/things/1/move", '{"id":2,"to":"todo"}'))).toEqual(
      fault("move_thing", "id", "repeated", "Give id once."),
    );
  }),
);

it.effect("path param: a value its field cannot decode is invalid", () =>
  Effect.gen(function* pathParam() {
    expect(outcomeOf(yield* post("/things/abc/move", '{"to":"todo"}'))).toEqual(
      fault("move_thing", "id", "invalid", "id is not valid."),
    );
  }),
);

it.effect("MCP validates parameters once and refuses invalid arguments before the callable", () =>
  Effect.gen(function* mcpParams() {
    const session = yield* openMcpSession(mcp, { authorization: "Bearer fixture" });
    nameChecks = 0;
    const bad = yield* callMcpTool(mcp, session, "pick_thing", { name: "bad" });
    expect(bad.result?.["isError"]).toBe(true);
    expect(JSON.stringify(bad.result)).toContain("Invalid parameters");
    nameChecks = 0;
    const good = yield* callMcpTool(mcp, session, "pick_thing", { name: "x" });
    expect(good.result?.["isError"]).toBe(false);
    expect(nameChecks).toBe(1);
  }),
);

it.effect("call(): an untrusted value names the capability and the issue", () =>
  Effect.gen(function* callInput() {
    const incoming = { headers: new Headers(), url: "https://app.example/" };
    const outcome = yield* Effect.promise(() =>
      call(app, moveThing, { id: 1, to: "gone" as "todo" }, incoming, { way: "web" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatchObject({
      _tag: "InputInvalid",
      feature: "move_thing",
      field: "to",
      issue: "invalid",
    });
  }),
);

it.effect("decodeInput names the feature it decodes for", () =>
  Effect.gen(function* publicDecode() {
    const error = yield* Effect.flip(decodeInput(moveThing, { id: 1 }, "json"));
    expect(error).toMatchObject({ feature: "move_thing", field: "to", issue: "missing" });
  }),
);

it.effect("a way can word its message per feature and field", () =>
  Effect.gen(function* perCapability() {
    const messages: Readonly<Record<string, Readonly<Record<string, string>>>> = {
      list_things: { q: "Type something to search for." },
    };
    const worded = httpFixture([listThings, moveThing], {
      endpoints: [
        endpoint(listThings, "GET /things"),
        endpoint(moveThing, "POST /things/:id/move"),
      ],
      overrides: {
        InputInvalid: (error) =>
          error.issue === "invalid" || error.issue === "missing"
            ? (messages[error.feature]?.[error.field] ?? error.message)
            : error.message,
      },
    });
    const handler = worded.handler;
    const missing = yield* answer(handler, webRequest("https://app.example/things"));
    const twice = yield* answer(handler, webRequest("https://app.example/things?q=a&q=b"));
    const other = yield* answer(
      handler,
      webRequest("https://app.example/things/1/move", { method: "POST", body: "{}" }),
    );
    yield* Effect.promise(worded.dispose);
    expect(missing.body).toEqual({
      error: { code: "invalid", message: "Type something to search for." },
    });
    expect(twice.body).toEqual({ error: { code: "invalid", message: "Give q once." } });
    expect(other.body).toEqual({ error: { code: "invalid", message: "to is required." } });
  }),
);

it.effect("the default kind view exposes only code and message", () =>
  Effect.gen(function* defaultBody() {
    const r = yield* answer(plainHttp, webRequest("https://app.example/things?q=a&q=b"));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: { code: "invalid", message: "Give q once." },
    });
  }),
);

it.effect("body: bytes that are not UTF-8 are field body, issue invalid", () =>
  Effect.gen(function* badUtf8() {
    const bytes = new Uint8Array([...new TextEncoder().encode('{"to":"'), 0xff, 0x22, 0x7d]);
    expect(outcomeOf(yield* post("/things/1/move", bytes))).toEqual(
      fault("move_thing", "body", "invalid", "The body is not valid UTF-8."),
    );
  }),
);
