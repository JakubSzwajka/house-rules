import { Schema } from "effect";
import type { PlainSchema } from "@house-rules/domain/contract";
import type { AnyEntryPoint } from "../feature/feature.ts";

export type SessionRole = "none" | "issue" | "clear";

export type SessionGrant = Readonly<{ token: string; expiresAt: number }>;

export type SessionOption<E extends AnyEntryPoint> = [
  Extract<E["output"]["Type"], SessionGrant>,
] extends [never]
  ? "clear"
  : "issue" | "clear";

type WithoutToken<Value> = Value extends unknown ? Omit<Value, "token"> : never;

export type BodyOf<E extends AnyEntryPoint, S extends SessionRole> = [S] extends ["issue"]
  ? WithoutToken<E["output"]["Type"]>
  : E["output"]["Type"];

const grantFields = ["token", "expiresAt"] as const;

const fieldsOf = (schema: PlainSchema): Readonly<Record<string, Schema.Top>> | undefined => {
  const fields: unknown = (schema as Partial<Readonly<{ fields: unknown }>>).fields;
  return typeof fields === "object" && fields !== null
    ? (fields as Readonly<Record<string, Schema.Top>>)
    : undefined;
};

const membersOf = (schema: PlainSchema): readonly PlainSchema[] =>
  "members" in schema && Array.isArray(schema.members)
    ? (schema.members as readonly PlainSchema[])
    : [schema];

export const checkSessionPlace = (
  name: string,
  method: string,
  session: SessionRole,
  output: PlainSchema,
): void => {
  if (session === "none") return;
  // Definition time, not a request: a GET runs from a link or an image, so it never sets or clears a session.
  if (method === "GET") throw new TypeError(`${name}: a session ${session} route cannot be a GET`);
  if (session === "clear") return;
  const fields = membersOf(output).map(fieldsOf);
  if (
    fields.some((member) => member === undefined) ||
    !fields.some((member) =>
      grantFields.every((key) => member !== undefined && Object.hasOwn(member, key)),
    )
  ) {
    throw new TypeError(
      `${name}: a session issue route needs a Struct or Union of Structs with token and expiresAt`,
    );
  }
};

const bodies = new WeakMap<PlainSchema, PlainSchema>();

export const bodySchemaOf = (feature: AnyEntryPoint, session: SessionRole): PlainSchema => {
  if (session !== "issue") return feature.output;
  const known = bodies.get(feature.output);
  if (known !== undefined) return known;
  // The token goes into the cookie only; the body keeps every other field.
  const members = membersOf(feature.output).map((member) => {
    const kept = Object.entries(fieldsOf(member) ?? {}).filter(([key]) => key !== "token");
    return Schema.Struct(Object.fromEntries(kept));
  });
  const body = (members.length === 1
    ? members[0]
    : Schema.Union(members)) as unknown as PlainSchema;
  bodies.set(feature.output, body);
  return body;
};
