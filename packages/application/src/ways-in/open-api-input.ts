import { type Endpoint, pathParamNames, writeMethods } from "../contract/endpoint.ts";

type Json = Record<string, unknown>;

const componentPrefix = "#/components/schemas/";

const resolved = (schema: Json, definitions: Json, seen: ReadonlySet<string> = new Set()): Json => {
  const ref = schema.$ref;
  if (typeof ref === "string" && ref.startsWith(componentPrefix) && !seen.has(ref)) {
    const { $ref: _ref, ...siblings } = schema;
    const target = definitions[ref.slice(componentPrefix.length)] as Json | undefined;
    return resolved({ ...target, ...siblings }, definitions, new Set([...seen, ref]));
  }
  if (!Array.isArray(schema.anyOf)) return schema;
  return {
    ...schema,
    anyOf: (schema.anyOf as Array<Json>).map((member) => resolved(member, definitions, seen)),
  };
};

const objectMembers = (schema: Json): ReadonlyArray<Json> =>
  Array.isArray(schema.anyOf) ? (schema.anyOf as Array<Json>) : [schema];

const withoutKeys = (schema: Json, keys: ReadonlyArray<string>): Json => {
  if (keys.length === 0) return schema;
  if (Array.isArray(schema.anyOf)) {
    return { ...schema, anyOf: (schema.anyOf as Array<Json>).map((m) => withoutKeys(m, keys)) };
  }
  const properties = Object.entries((schema.properties ?? {}) as Json).filter(
    ([key]) => !keys.includes(key),
  );
  const required = ((schema.required ?? []) as Array<string>).filter((key) => !keys.includes(key));
  return { ...schema, properties: Object.fromEntries(properties), required };
};

const requiredOf = (schema: Json): ReadonlyArray<string> =>
  (schema.required ?? []) as Array<string>;

export const inputParts = (
  shape: Endpoint,
  input: Json,
  definitions: Json,
): Readonly<{ parameters: ReadonlyArray<Json>; body?: Json }> => {
  const params = pathParamNames(shape);
  const fields = resolved(input, definitions);
  const members = objectMembers(fields);
  const fieldSchema = (key: string): unknown =>
    members.map((member) => (member.properties as Json | undefined)?.[key]).find(Boolean) ?? {};
  const parameters: Array<Json> = params.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: fieldSchema(name),
  }));
  const rest = withoutKeys(fields, params);
  // With no path fields, a named input keeps its $ref.
  if (writeMethods.has(shape.method))
    return { parameters, body: params.length === 0 ? input : rest };
  if (Array.isArray(rest.anyOf)) {
    // The whole object is required when every member still requires a field, such as its discriminator.
    const required = objectMembers(rest).every((member) => requiredOf(member).length > 0);
    parameters.push({
      name: "input",
      in: "query",
      required,
      style: "form",
      explode: true,
      schema: rest,
    });
    return { parameters };
  }
  for (const [name, schema] of Object.entries((rest.properties ?? {}) as Json)) {
    const required = requiredOf(rest).includes(name);
    // An array field goes out as one key per item, which the fetch handler gathers back in order.
    const list = resolved(schema as Json, definitions).type === "array";
    parameters.push({
      name,
      in: "query",
      required,
      ...(list ? { style: "form", explode: true } : {}),
      schema,
    });
  }
  return { parameters };
};
