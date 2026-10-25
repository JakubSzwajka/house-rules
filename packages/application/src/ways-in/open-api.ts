import { JsonSchema, Schema, SchemaAST, SchemaRepresentation } from "effect";
import { prefixOf } from "../contract/api.ts";
import { prefixMismatch } from "./api-prefix.ts";
import type { AnyFeature } from "../feature/feature.ts";
import { type Endpoint, failureCodeHeader } from "../contract/endpoint.ts";
import { bodySchemaOf } from "../contract/session.ts";
import { requestIdHeader } from "../call/request-id.ts";
import type { ErrorKind } from "@house-rules/domain/contract";
import { inputParts } from "./open-api-input.ts";
import { kindStatuses } from "./views.ts";

export type OpenApiSecurityScheme =
  | Readonly<{ type: "http"; scheme: string; bearerFormat?: string; description?: string }>
  | Readonly<{
      type: "apiKey";
      name: string;
      in: "query" | "header" | "cookie";
      description?: string;
    }>
  | Readonly<{ type: "openIdConnect"; openIdConnectUrl: string; description?: string }>
  | Readonly<{ type: "oauth2"; flows: Readonly<Record<string, unknown>>; description?: string }>;

export type OpenApiSecurity = Readonly<{
  schemes: Readonly<Record<string, OpenApiSecurityScheme>>;
  require?: ReadonlyArray<Readonly<Record<string, ReadonlyArray<string>>>>;
}>;

export type OpenApiOptions = Readonly<{
  title: string;
  version: string;
  description?: string;
  prefix?: `/${string}`;
  servers?: ReadonlyArray<Readonly<{ url: string; description?: string }>>;
  security?: OpenApiSecurity;
  public?: readonly AnyFeature[] | undefined;
}>;

type Json = Record<string, unknown>;

export type OpenApiDocument = Readonly<{
  openapi: "3.1.0";
  info: Json;
  paths: Record<string, Record<string, Json>>;
  components: Readonly<{ schemas: Json; securitySchemes?: Json }>;
  servers?: ReadonlyArray<Json>;
  security?: ReadonlyArray<Json>;
}>;

const kindsOf = (feature: AnyFeature): readonly ErrorKind[] => {
  const walk = (ast: SchemaAST.AST): ErrorKind[] => {
    if (ast._tag === "Union") return ast.types.flatMap(walk);
    if (ast._tag !== "Objects") return [];
    const kind = ast.propertySignatures.find((property) => property.name === "kind")?.type;
    return kind?._tag === "Literal" &&
      typeof kind.literal === "string" &&
      Object.hasOwn(kindStatuses, kind.literal)
      ? [kind.literal as ErrorKind]
      : [];
  };
  return [
    ...new Set<ErrorKind>([
      ...walk(SchemaAST.toEncoded(feature.failure.ast)),
      "invalid",
      "forbidden",
      "unavailable",
    ]),
  ];
};

const isClientError = (key: string): boolean =>
  key === "default" || (Number(key) >= 400 && Number(key) < 500);

const failureResponses = (shape: Endpoint): Record<string, Json> => {
  const codesAt = new Map<string, Set<string>>([["default", new Set()]]);
  for (const kind of kindsOf(shape.feature)) {
    const key = String(kindStatuses[kind]);
    const codes = codesAt.get(key) ?? new Set<string>();
    if (shape.codes.includes(kind) && isClientError(key)) codes.add(kind);
    codesAt.set(key, codes);
  }
  return Object.fromEntries(
    [...codesAt].map(([status, codes]) => [
      status,
      {
        description:
          status === "default"
            ? "A protocol refusal or 500 internal_error."
            : `A failure mapped by kind to ${status}.`,
        ...(codes.size === 0 || !isClientError(status)
          ? {}
          : {
              headers: {
                [failureCodeHeader]: {
                  description: "A declared kind code. Only sent for 4xx responses.",
                  schema: { type: "string", enum: [...codes] },
                },
              },
            }),
        content: { "application/json": { schema: {} } },
      },
    ]),
  );
};

type Operation = Readonly<{
  shape: Endpoint;
  operationId: string;
  input: Json;
  output: Json;
  definitions: Json;
}>;

const operationOf = ({ shape, operationId, input, output, definitions }: Operation): Json => {
  const { parameters, body } = inputParts(shape, input, definitions);
  return {
    operationId,
    description: shape.feature.description,
    ...(shape.feature.readOnly ? { "x-house-rules-read-only": true } : {}),
    ...(shape.feature.destructive ? { "x-house-rules-destructive": true } : {}),
    parameters,
    ...(body === undefined
      ? {}
      : { requestBody: { required: true, content: { "application/json": { schema: body } } } }),
    responses: {
      [String(shape.status)]: {
        description: "Success",
        headers: { [requestIdHeader]: { schema: { type: "string" } } },
        content: { "application/json": { schema: output } },
      },
      ...failureResponses(shape),
    },
  };
};

const operationIds = (endpoints: ReadonlyArray<Endpoint>): ReadonlyArray<string> => {
  const count = new Map<string, number>();
  for (const { feature } of endpoints) count.set(feature.name, (count.get(feature.name) ?? 0) + 1);
  const ids = endpoints.map(({ feature, method, path }) =>
    count.get(feature.name) === 1
      ? feature.name
      : `${feature.name}_${method.toLowerCase()}${path.replace(/[^A-Za-z0-9]+/gu, "_")}`.replace(
          /_+$/u,
          "",
        ),
  );
  return ids;
};

const jsonSchemas = (
  schemas: ReadonlyArray<Schema.Top>,
): Readonly<{ schemas: ReadonlyArray<Json>; definitions: Json }> => {
  const [first, ...rest] = schemas.map((schema) => Schema.toCodecJson(schema).ast);
  if (first === undefined) return { schemas: [], definitions: {} };
  // One pool for every schema, so a shared error or record becomes one component.
  const document = JsonSchema.toMultiDocumentOpenApi3_1(
    SchemaRepresentation.toJsonSchemaMultiDocument(
      SchemaRepresentation.toRepresentations([first, ...rest]),
      { onExcessProperty: "error" },
    ),
  );
  return { schemas: document.schemas as ReadonlyArray<Json>, definitions: document.definitions };
};

export const toOpenApi = <const Endpoints extends readonly Endpoint[]>(
  endpoints: Endpoints,
  options: OpenApiOptions,
): OpenApiDocument => {
  const prefix =
    options.prefix ?? endpoints.map(prefixOf).find((value) => value !== undefined) ?? "";
  const mismatch = prefixMismatch(endpoints, prefix);
  if (mismatch !== undefined) throw new TypeError(`toOpenApi: ${mismatch}`);
  const converted = jsonSchemas(
    endpoints.flatMap((shape) => [shape.feature.input, bodySchemaOf(shape.feature, shape.session)]),
  );
  const ids = operationIds(endpoints);
  const used = new Set<string>();
  const paths: Record<string, Record<string, Json>> = {};
  endpoints.forEach((shape, index) => {
    const at = `${prefix}${shape.path}`.replace(/:([A-Za-z_]\w*)/gu, "{$1}");
    const method = shape.method.toLowerCase();
    const item = paths[at] ?? {};
    if (Object.hasOwn(item, method)) {
      // Build time, not a request: the router would answer only one of the two.
      throw new TypeError(`toOpenApi: ${shape.method} ${at} is listed twice`);
    }
    const operationId = ids[index] ?? shape.feature.name;
    if (used.has(operationId)) {
      // Build time, not a request: OpenAPI needs every operationId to be unique.
      throw new TypeError(`toOpenApi: operationId ${operationId} is used twice; rename a contract`);
    }
    used.add(operationId);
    item[method] = operationOf({
      shape,
      operationId,
      input: converted.schemas[index * 2] ?? {},
      output: converted.schemas[index * 2 + 1] ?? {},
      definitions: converted.definitions,
    });
    if (options.public?.includes(shape.feature) === true) item[method].security = [];
    paths[at] = item;
  });
  const { security } = options;
  return {
    openapi: "3.1.0",
    info: {
      title: options.title,
      version: options.version,
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    ...(options.servers === undefined ? {} : { servers: options.servers }),
    paths,
    components: {
      schemas: converted.definitions,
      ...(security === undefined ? {} : { securitySchemes: security.schemes }),
    },
    ...(security === undefined
      ? {}
      : {
          security:
            security.require ?? Object.keys(security.schemes).map((name) => ({ [name]: [] })),
        }),
  };
};
