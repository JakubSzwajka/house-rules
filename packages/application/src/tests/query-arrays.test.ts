import { featureFixture } from "./feature-fixtures.ts";
import { bindFixture, fixtureLayer, testActor } from "./execution-fixtures.ts";
import { defineOperation } from "@house-rules/domain";
import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  composition,
  defineWay,
  May,
  Mean,
  endpoint,
  toFetchHandler,
  toHttpClient,
  toOpenApi,
} from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";

const Status = Schema.Literals(["todo", "doing", "done"]);

const listTasks = bindFixture(
  featureFixture(
    defineOperation("list_tasks", {
      description: "List tasks by status and tag.",
      input: Schema.Struct({
        status: Schema.optionalKey(Schema.Array(Status)),
        tags: Schema.optionalKey(Schema.Array(Schema.String)),
        limit: Schema.optionalKey(Schema.Int),
        profile: Schema.Literals(["free", "strict"]).pipe(
          Schema.withDecodingDefaultKey(Effect.succeed("free" as const)),
        ),
      }),
      output: Schema.Struct({
        status: Schema.optionalKey(Schema.Array(Status)),
        tags: Schema.optionalKey(Schema.Array(Schema.String)),
        limit: Schema.optionalKey(Schema.Int),
        profile: Schema.String,
      }),
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  (input) => Effect.succeed(input),
);

const searchTasks = bindFixture(
  featureFixture(
    defineOperation("search_tasks", {
      description: "Search by text or by owner, both with a status list.",
      input: Schema.Union([
        Schema.Struct({
          by: Schema.Literal("text"),
          q: Schema.String,
          status: Schema.Array(Status),
        }),
        Schema.Struct({
          by: Schema.Literal("owner"),
          owner: Schema.String,
          status: Schema.Array(Status),
        }),
      ]),
      output: Schema.Struct({ status: Schema.Array(Status) }),
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  (input) => Effect.succeed({ status: input.status }),
);

const at = {
  list: endpoint(listTasks, "GET /tasks"),
  search: endpoint(searchTasks, "GET /tasks/search"),
} as const;

const features = [listTasks, searchTasks] as const;
const way = defineWay({
  name: "web",
  path: "/",
  protocol: "http",
  features,
  endpoints: [at.list, at.search],
  who: { resolve: () => Effect.succeed(testActor) },
  mean: Mean.no,
});
const app = composition({
  modules: { mounts: [], layer: fixtureLayer(features) },
  features: features,
  ways: [way],
  may: Effect.succeed(May.fixed([])),
  system: [],
});
const http = toFetchHandler(app);
afterAll(() => http.dispose().then(() => app.dispose()));

const get = (query: string, path = "/tasks") =>
  answer(http, webRequest(`https://app.example${path}?${query}`));

it.effect("an array field takes one key as a one-item list", () =>
  Effect.gen(function* oneValue() {
    const r = yield* get("status=todo");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: ["todo"], profile: "free" });
  }),
);

it.effect("an array field takes a repeated key as a list, in order", () =>
  Effect.gen(function* twoValues() {
    const r = yield* get("status=done&limit=5&status=todo");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: ["done", "todo"], limit: 5, profile: "free" });
  }),
);

it.effect("a repeated key on a field that is not a list stays refused", () =>
  Effect.gen(function* repeatOnScalar() {
    const r = yield* get("limit=5&limit=6");
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: { code: "invalid", message: "Give limit once." },
    });
  }),
);

it.effect("a comma is data: a comma list is one item, never split", () =>
  Effect.gen(function* commaKept() {
    const statuses = yield* get("status=todo,doing");
    expect(statuses.status).toBe(400);
    expect(statuses.body).toMatchObject({ error: { message: "status.0 is not valid." } });
    const tags = yield* get("tags=a,b&tags=c");
    expect(tags.status).toBe(200);
    expect(tags.body).toEqual({ tags: ["a,b", "c"], profile: "free" });
  }),
);

it.effect("an unknown key stays refused next to array fields", () =>
  Effect.gen(function* unknownKey() {
    const r = yield* get("status=todo&state=todo");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { message: "state is not a field here." } });
  }),
);

it.effect("a decoding default fills an absent key, and a sent key wins", () =>
  Effect.gen(function* decodingDefault() {
    expect((yield* get("")).body).toEqual({ profile: "free" });
    expect((yield* get("profile=strict")).body).toEqual({ profile: "strict" });
    expect((yield* get("profile=loose")).status).toBe(400);
  }),
);

it.effect("Union members that all read a list gather the key too", () =>
  Effect.gen(function* unionArrays() {
    const one = yield* get("by=text&q=x&status=doing", "/tasks/search");
    expect(one.body).toEqual({ status: ["doing"] });
    const two = yield* get("by=owner&owner=ada&status=todo&status=done", "/tasks/search");
    expect(two.body).toEqual({ status: ["todo", "done"] });
    const twice = yield* get("by=owner&by=text&owner=ada&status=todo", "/tasks/search");
    expect(twice.body).toMatchObject({ error: { message: "Give by once." } });
  }),
);

const viaHandler = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) =>
      http(webRequest(String(input), init)),
    ),
  );

it.effect("the client sends one key per item and reads the list back", () =>
  Effect.gen(function* clientRoundTrip() {
    const client = toHttpClient([at.list, at.search], { baseUrl: "https://app.example" });
    const sent: Array<string> = [];
    const listed = yield* client
      .list_tasks({ status: ["doing", "todo"], tags: ["a,b"], profile: "strict" })
      .pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, (input, init) => {
          sent.push(new URL(String(input)).search);
          return http(webRequest(String(input), init));
        }),
      );
    expect(sent).toEqual(["?status=doing&status=todo&tags=a%2Cb&profile=strict"]);
    expect(listed).toEqual({ status: ["doing", "todo"], tags: ["a,b"], profile: "strict" });
    const found = yield* viaHandler(client.search_tasks({ by: "text", q: "x", status: ["done"] }));
    expect(found).toEqual({ status: ["done"] });
  }),
);

it.effect("the client sends no key for an empty list", () =>
  Effect.gen(function* emptyList() {
    const client = toHttpClient([at.list], { baseUrl: "https://app.example" });
    expect(yield* viaHandler(client.list_tasks({ status: [], profile: "free" }))).toEqual({
      profile: "free",
    });
  }),
);

it("OpenAPI marks an array query parameter form and exploded, and no other", () => {
  const document = toOpenApi([at.list], { title: "Tasks", version: "1" });
  const operation = (document.paths["/tasks"] as Record<string, Record<string, unknown>>)[
    "get"
  ] as { parameters: ReadonlyArray<Record<string, unknown>> };
  const byName = Object.fromEntries(operation.parameters.map((p) => [p["name"], p]));
  expect(byName["status"]).toMatchObject({ in: "query", style: "form", explode: true });
  expect(byName["tags"]).toMatchObject({ in: "query", style: "form", explode: true });
  expect(byName["limit"]).not.toHaveProperty("style");
  expect(byName["limit"]).not.toHaveProperty("explode");
});
