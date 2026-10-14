import { Schema } from "effect";

export const Principal = Schema.Struct({
  issuer: Schema.String,
  subject: Schema.String,
  audience: Schema.Array(Schema.String),
  scopes: Schema.Array(Schema.String),
  claims: Schema.Record(Schema.String, Schema.Unknown),
});

export type Principal = typeof Principal.Type;
