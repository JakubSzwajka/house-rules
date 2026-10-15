import { JsonSchema, Schema, SchemaAST, SchemaRepresentation } from "effect";
import { type AnyContract, failureSchemaOf } from "../contract/contract.ts";
import { type EndpointShape, failureCodeHeader } from "../contract/endpoint.ts";
import { bodySchemaOf } from "../contract/session.ts";
import { requestIdHeader } from "../call/request-id.ts";
import { checkPrefixOwner } from "./api-prefix.ts";
import { inputParts } from "./open-api-input.ts";
import { defaultViews, staticCodeOf, staticStatusOf } from "./views.ts";

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
  views?: Readonly<Record<string, unknown>>;
  security?: OpenApiSecurity;
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

const tagsOf = (contract: AnyContract): ReadonlyArray<string> => {
  const walk = (ast: SchemaAST.AST): ReadonlyArray<string> => {
    if (ast._tag === "Union") return ast.types.flatMap(walk);
    if (ast._tag !== "Objects") return [];
    const tag = ast.propertySignatures.find((property) => property.name === "_tag")?.type;
    return tag?._tag === "Literal" && typeof tag.literal === "string" ? [tag.literal] : [];
  };
  return [
    ...new Set([
      ...walk(SchemaAST.toEncoded(failureSchemaOf(contract).ast)),
      "InputInvalid",
      "Refused",
    ]),
  ];
};

const isClientError = (key: string): boolean =>
  key === "default" || (Number(key) >= 400 && Number(key) < 500);

const failureResponses = (
  shape: EndpointShape,
  views: Readonly<Record<string, unknown>>,
): Record<string, Json> => {
  const codesAt = new Map<string, Set<string>>([["default", new Set()]]);
  const placed = new Set<string>();
  for (const tag of tagsOf(shape.contract)) {
    const view = Object.hasOwn(views, tag) ? views[tag] : undefined;
    const status = staticStatusOf(view);
    const key = status === undefined ? "default" : String(status);
    const codes = codesAt.get(key) ?? new Set();
    const code = staticCodeOf(view);
    if (code !== undefined && shape.codes.includes(code) && isClientError(key)) {
      codes.add(code);
      placed.add(code);
    }
    codesAt.set(key, codes);
  }
  for (const code of shape.codes) if (!placed.has(code)) codesAt.get("default")?.add(code);
  return Object.fromEntries(
    [...codesAt].map(([status, codes]) => [
      status,
      {
        description:
          status === "default"
            ? "A failure whose status its view decides, a refusal, or 500 internal_error."
            : `A failure its view answers with ${status}.`,
        ...(codes.size === 0 || !isClientError(status)
          ? {}
          : {
              headers: {
                [failureCodeHeader]: {
                  description: "A public failure code the view chose to send. Often absent.",
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
  shape: EndpointShape;
  operationId: string;
  input: Json;
  output: Json;
  definitions: Json;
}>;

const operationOf = (
  { shape, operationId, input, output, definitions }: Operation,
  options: OpenApiOptions,
): Json => {
  const { parameters, body } = inputParts(shape, input, definitions);
  const views = { ...defaultViews, ...options.views };
  return {
    operationId,
    description: shape.contract.description,
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
      ...failureResponses(shape, views),
    },
    ...(options.security !== undefined && shape.contract.permission === "public"
      ? { security: [] }
      : {}),
  };
};

const operationIds = (endpoints: ReadonlyArray<EndpointShape>): ReadonlyArray<string> => {
  const count = new Map<string, number>();
  for (const { contract } of endpoints)
    count.set(contract.name, (count.get(contract.name) ?? 0) + 1);
  const ids = endpoints.map(({ contract, method, path }) =>
    count.get(contract.name) === 1
      ? contract.name
      : `${contract.name}_${method.toLowerCase()}${path.replace(/[^A-Za-z0-9]+/gu, "_")}`.replace(
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

export const toOpenApi = (
  endpoints: ReadonlyArray<EndpointShape>,
  options: OpenApiOptions,
): OpenApiDocument => {
  checkPrefixOwner(endpoints, options.prefix, "toOpenApi");
  const converted = jsonSchemas(
    endpoints.flatMap((shape) => [
      shape.contract.input,
      bodySchemaOf(shape.contract, shape.session),
    ]),
  );
  const ids = operationIds(endpoints);
  const used = new Set<string>();
  const paths: Record<string, Record<string, Json>> = {};
  endpoints.forEach((shape, index) => {
    const at = `${options.prefix ?? ""}${shape.path}`.replace(/:([A-Za-z_]\w*)/gu, "{$1}");
    const method = shape.method.toLowerCase();
    const item = paths[at] ?? {};
    if (Object.hasOwn(item, method)) {
      // Build time, not a request: the router would answer only one of the two.
      throw new TypeError(`toOpenApi: ${shape.method} ${at} is listed twice`);
    }
    const operationId = ids[index] ?? shape.contract.name;
    if (used.has(operationId)) {
      // Build time, not a request: OpenAPI needs every operationId to be unique.
      throw new TypeError(`toOpenApi: operationId ${operationId} is used twice; rename a contract`);
    }
    used.add(operationId);
    item[method] = operationOf(
      {
        shape,
        operationId,
        input: converted.schemas[index * 2] ?? {},
        output: converted.schemas[index * 2 + 1] ?? {},
        definitions: converted.definitions,
      },
      options,
    );
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
