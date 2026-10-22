import { Schema } from "effect";

export const PasswordAlgorithm = "PBKDF2-SHA256";
export const PasswordIterations = 600_000;

export const PasswordHash = Schema.Struct({
  algorithm: Schema.Literal(PasswordAlgorithm),
  iterations: Schema.Int,
  salt: Schema.String,
  hash: Schema.String,
});
export type PasswordHash = typeof PasswordHash.Type;
