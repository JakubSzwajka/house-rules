import { featureFixture } from "./feature-fixtures.ts";
import { defineOperation } from "@house-rules/domain";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { endpoint, failureCodeHeader, toOpenApi } from "../index.ts";

type Json = Record<string, unknown>;
type Operation = Json & { operationId: string; parameters: Array<Json>; requestBody?: Json };

const integer = {
  type: "integer",
  minimum: Number.MIN_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
};

const lookup = featureFixture(
  defineOperation("lookup", {
    description: "A named Struct input.",
    input: Schema.Struct({ id: Schema.Int, limit: Schema.Int }).annotate({ identifier: "Lookup" }),
    output: Schema.Struct({ ok: Schema.Boolean }),
    failure: Schema.Never,
    permission: null,
  }),
);

const search = featureFixture(
  defineOperation("search", {
    description: "A named Union input.",
    input: Schema.Union([
      Schema.Struct({ id: Schema.Int, by: Schema.Literal("guest"), guest: Schema.String }).annotate(
        {
          identifier: "ByGuest",
        },
      ),
      Schema.Struct({ id: Schema.Int, by: Schema.Literal("nights"), minNights: Schema.Int }),
    ]).annotate({ identifier: "Search" }),
    output: Schema.Struct({ ok: Schema.Boolean }),
    failure: Schema.Never,
    permission: null,
  }),
);

const document = toOpenApi(
  [
    endpoint(lookup, "GET /lookup/:id"),
    endpoint(lookup, "PATCH /lookup/:id"),
    endpoint(search, "GET /search/:id"),
  ],
  { title: "probe", version: "1" },
);

const operation = (path: string, method: string) =>
  (document.paths[path] as Record<string, Operation>)[method] as Operation;

const resolve = (schema: unknown): Json => {
  const ref = (schema as Json | undefined)?.$ref;
  return typeof ref === "string"
    ? resolve(document.components.schemas[ref.split("/").at(-1) ?? ""])
    : (schema as Json);
};

it("a GET with a named Struct input keeps every field as a path or query parameter", () => {
  expect(operation("/lookup/{id}", "get").parameters).toEqual([
    { name: "id", in: "path", required: true, schema: integer },
    { name: "limit", in: "query", required: true, schema: integer },
  ]);
});

it("a write with a named Struct input leaves the path field out of the body", () => {
  const body = resolve(
    ((operation("/lookup/{id}", "patch").requestBody?.content as Json)["application/json"] as Json)
      .schema,
  );
  expect(body.properties).toEqual({ limit: integer });
  expect(body.required).toEqual(["limit"]);
});

it("a GET with a named Union input resolves each member, and the input is required", () => {
  const [path, query] = operation("/search/{id}", "get").parameters;
  expect(path).toEqual({ name: "id", in: "path", required: true, schema: integer });
  expect(query).toMatchObject({ name: "input", in: "query", required: true });
  const members = (query?.schema as Json).anyOf as Array<Json>;
  expect(members.map((member) => Object.keys(member.properties as Json))).toEqual([
    ["by", "guest"],
    ["by", "minNights"],
  ]);
});

it("each operation gets its own operationId, even for one contract on two endpoints", () => {
  const ids = [
    operation("/lookup/{id}", "get").operationId,
    operation("/lookup/{id}", "patch").operationId,
    operation("/search/{id}", "get").operationId,
  ];
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[2]).toBe("search");
});

it("a response names no failure header when the endpoint declares no public code", () => {
  const plain = toOpenApi([endpoint(lookup, "GET /lookup/:id")], {
    title: "probe",
    version: "1",
  });
  expect(JSON.stringify(plain)).not.toContain("x-failure");
  const coded = toOpenApi([endpoint(lookup, "GET /lookup/:id", { codes: ["invalid"] })], {
    title: "probe",
    version: "1",
  });
  const responses = (coded.paths["/lookup/{id}"]?.get as Json).responses as Record<string, Json>;
  expect(responses["400"]).toMatchObject({
    headers: { [failureCodeHeader]: { schema: { type: "string", enum: ["invalid"] } } },
  });
  expect(responses.default?.headers).toBeUndefined();
});
