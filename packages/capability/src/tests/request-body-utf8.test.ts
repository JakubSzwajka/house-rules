import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { composition, defineContract, implement, route, toFetchHandler } from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";

const nameThing = implement(
  defineContract("name_thing", {
    description: "Name a thing.",
    input: Schema.Struct({ name: Schema.String }),
    output: Schema.Struct({ name: Schema.String }),
    failure: Schema.Never,
    permission: "public",
  }),
  ({ name }) => Effect.succeed({ name }),
);

const app = composition({ layer: Layer.empty, caller: () => Effect.succeed(Context.empty()) });
const http = toFetchHandler(app, { routes: [route(nameThing, "POST /name")] });
afterAll(() => http.dispose().then(() => app.dispose()));

const post = (body: Uint8Array) =>
  answer(http, webRequest("https://app.example/name", { method: "POST", body }));

it.effect("a body that is not UTF-8 is a 400, not a silent replacement character", () =>
  Effect.gen(function* badUtf8() {
    const r = yield* post(
      new Uint8Array([...new TextEncoder().encode('{"name":"'), 0xff, 0x22, 0x7d]),
    );
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: { code: "invalid_input", message: "The body is not valid UTF-8.", field: "body" },
    });
  }),
);

it.effect("a truncated multi-byte character is not UTF-8 either", () =>
  Effect.gen(function* truncated() {
    const whole = new TextEncoder().encode('{"name":"ż"}');
    const cut = new Uint8Array([...whole.slice(0, 10), ...whole.slice(11)]);
    expect((yield* post(cut)).status).toBe(400);
  }),
);

it.effect("valid UTF-8 beyond ASCII still decodes", () =>
  Effect.gen(function* goodUtf8() {
    const r = yield* post(new TextEncoder().encode('{"name":"żółw"}'));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ name: "żółw" });
    expect(r.headers.get("content-type")).toBe("application/json");
  }),
);
