import { featureFixture } from "./feature-fixtures.ts";
import { defineOperation } from "@house-rules/domain";
import { bindFixture } from "./execution-fixtures.ts";
import { httpFixture } from "./router-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { endpoint } from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";

const nameThing = bindFixture(
  featureFixture(
    defineOperation("name_thing", {
      description: "Name a thing.",
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.Struct({ name: Schema.String }),
      failure: Schema.Never,
      permission: null,
    }),
  ),
  ({ name }) => Effect.succeed({ name }),
);

const fixture = httpFixture([nameThing], { endpoints: [endpoint(nameThing, "POST /name")] });
const http = fixture.handler;
afterAll(fixture.dispose);

const post = (body: Uint8Array) =>
  answer(http, webRequest("https://app.example/name", { method: "POST", body }));

it.effect("a body that is not UTF-8 is a 400, not a silent replacement character", () =>
  Effect.gen(function* badUtf8() {
    const r = yield* post(
      new Uint8Array([...new TextEncoder().encode('{"name":"'), 0xff, 0x22, 0x7d]),
    );
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: { code: "invalid", message: "The body is not valid UTF-8." },
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
