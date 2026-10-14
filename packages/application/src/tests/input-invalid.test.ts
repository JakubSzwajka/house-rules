import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import {
  call,
  composition,
  decodeInput,
  defineContract,
  implement,
  type InputInvalid,
  route,
  toFetchHandler,
  toMcpHandler,
  tool,
  type View,
} from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { callMcpTool, openMcpSession } from "./delivery-mcp-client.ts";

const Status = Schema.Literals(["todo", "doing", "done"]);

const listThings = implement(
  defineContract("list_things", {
    description: "List things.",
    input: Schema.Struct({ q: Schema.String, limit: Schema.optionalKey(Schema.Int) }),
    output: Schema.Struct({ q: Schema.String }),
    failure: Schema.Never,
    permission: "public",
    annotations: { readOnly: true },
  }),
  ({ q }) => Effect.succeed({ q }),
);

const moveThing = implement(
  defineContract("move_thing", {
    description: "Move a thing.",
    input: Schema.Struct({ id: Schema.Int, to: Status }),
    output: Schema.Struct({ id: Schema.Int, to: Status }),
    failure: Schema.Never,
    permission: "public",
  }),
  (input) => Effect.succeed(input),
);

let nameChecks = 0;
const holdsTwice = Schema.makeFilter<string>(() => {
  // The toolkit decodes, invoke encodes, then the contract decodes: only that third check fails.
  nameChecks += 1;
  return nameChecks <= 2;
});

const pickThing = implement(
  defineContract("pick_thing", {
    description: "Pick a thing by name.",
    input: Schema.Struct({ name: Schema.String.check(holdsTwice) }),
    output: Schema.Struct({ name: Schema.String }),
    failure: Schema.Never,
    permission: "public",
    annotations: { readOnly: true },
  }),
  ({ name }) => Effect.succeed({ name }),
);

const exposed = {
  InputInvalid: (error: InputInvalid): View => ({
    status: 422,
    body: {
      capabilityName: error.capabilityName,
      field: error.field,
      issue: error.issue,
      message: error.message,
    },
  }),
};

const nobody = () => Effect.succeed(Context.empty());
const app = composition({ layer: Layer.empty, caller: nobody, views: exposed });
const plain = composition({ layer: Layer.empty, caller: nobody });
const http = toFetchHandler(app, {
  routes: [route(listThings, "GET /things"), route(moveThing, "POST /things/:id/move")],
});
const plainHttp = toFetchHandler(plain, { routes: [route(listThings, "GET /things")] });
const mcp = toMcpHandler(app, {
  path: "/mcp",
  name: "test",
  version: "0",
  tools: [tool(pickThing, { title: "Pick", idempotent: true, openWorld: false })],
});
afterAll(() =>
  Promise.all([http.dispose(), plainHttp.dispose(), mcp.dispose()]).then(() =>
    Promise.all([app.dispose(), plain.dispose()]),
  ),
);

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

const fault = (capabilityName: string, field: string, issue: string, message: string) => ({
  status: 422,
  body: { capabilityName, field, issue, message },
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

it.effect("MCP params: arguments the contract refuses name the capability and the issue", () =>
  Effect.gen(function* mcpParams() {
    const session = yield* openMcpSession(mcp);
    nameChecks = 0;
    const { result } = yield* callMcpTool(mcp, session, "pick_thing", { name: "x" });
    expect(result?.["isError"]).toBe(true);
    const content = result?.["content"] as ReadonlyArray<{ text: string }>;
    expect(JSON.parse(content[0]?.text ?? "")).toEqual({
      capabilityName: "pick_thing",
      field: "name",
      issue: "invalid",
      message: "name is not valid.",
    });
  }),
);

it.effect("call(): an untrusted value names the capability and the issue", () =>
  Effect.gen(function* callInput() {
    const incoming = { headers: new Headers(), url: "https://app.example/" };
    const outcome = yield* Effect.promise(() =>
      call(app, moveThing, { id: 1, to: "gone" as "todo" }, incoming),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatchObject({
      _tag: "InputInvalid",
      capabilityName: "move_thing",
      field: "to",
      issue: "invalid",
    });
  }),
);

it.effect("decodeInput names the contract it decodes for", () =>
  Effect.gen(function* publicDecode() {
    const error = yield* Effect.flip(decodeInput(moveThing.contract, { id: 1 }, "json"));
    expect(error).toMatchObject({ capabilityName: "move_thing", field: "to", issue: "missing" });
  }),
);

it.effect("a views table can word a message per capability and field", () =>
  Effect.gen(function* perCapability() {
    const messages: Readonly<Record<string, Readonly<Record<string, string>>>> = {
      list_things: { q: "Type something to search for." },
    };
    const worded = composition({
      layer: Layer.empty,
      caller: nobody,
      views: {
        InputInvalid: (error: InputInvalid): View => ({
          status: 422,
          body: {
            message:
              error.issue === "invalid" || error.issue === "missing"
                ? (messages[error.capabilityName]?.[error.field] ?? error.message)
                : error.message,
          },
        }),
      },
    });
    const handler = toFetchHandler(worded, {
      routes: [route(listThings, "GET /things"), route(moveThing, "POST /things/:id/move")],
    });
    const missing = yield* answer(handler, webRequest("https://app.example/things"));
    const twice = yield* answer(handler, webRequest("https://app.example/things?q=a&q=b"));
    const other = yield* answer(
      handler,
      webRequest("https://app.example/things/1/move", { method: "POST", body: "{}" }),
    );
    yield* Effect.promise(() => handler.dispose().then(() => worded.dispose()));
    expect(missing.body).toEqual({ message: "Type something to search for." });
    expect(twice.body).toEqual({ message: "Give q once." });
    expect(other.body).toEqual({ message: "to is required." });
  }),
);

it.effect("the default view keeps its body: code, message and field only", () =>
  Effect.gen(function* defaultBody() {
    const r = yield* answer(plainHttp, webRequest("https://app.example/things?q=a&q=b"));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: { code: "invalid_input", message: "Give q once.", field: "q" },
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
