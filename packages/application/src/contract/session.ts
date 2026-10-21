import { Schema } from "effect";
import type { PlainSchema } from "@house-rules/domain/contract";
import type { AnyFeature } from "../feature/feature.ts";

export type SessionRole = "none" | "issue" | "clear";

export type SessionGrant = Readonly<{ token: string; expiresAt: number }>;

export type SessionOption<E extends AnyFeature> = E["output"]["Type"] extends SessionGrant
  ? "issue" | "clear"
  : "clear";

export type BodyOf<E extends AnyFeature, S extends SessionRole> = [S] extends ["issue"]
  ? Omit<E["output"]["Type"], "token">
  : E["output"]["Type"];

const grantFields = ["token", "expiresAt"] as const;

const fieldsOf = (schema: PlainSchema): Readonly<Record<string, Schema.Top>> | undefined => {
  const fields: unknown = (schema as Partial<Readonly<{ fields: unknown }>>).fields;
  return typeof fields === "object" && fields !== null
    ? (fields as Readonly<Record<string, Schema.Top>>)
    : undefined;
};

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
  const fields = fieldsOf(output);
  if (fields === undefined || !grantFields.every((key) => Object.hasOwn(fields, key))) {
    throw new TypeError(
      `${name}: a session issue route needs a Struct output with token and expiresAt`,
    );
  }
};

const bodies = new WeakMap<PlainSchema, PlainSchema>();

export const bodySchemaOf = (feature: AnyFeature, session: SessionRole): PlainSchema => {
  if (session !== "issue") return feature.output;
  const known = bodies.get(feature.output);
  if (known !== undefined) return known;
  // The token goes into the cookie only; the body keeps every other field.
  const kept = Object.entries(fieldsOf(feature.output) ?? {}).filter(([key]) => key !== "token");
  const body = Schema.Struct(Object.fromEntries(kept)) as unknown as PlainSchema;
  bodies.set(feature.output, body);
  return body;
};
