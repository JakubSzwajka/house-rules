import { Schema } from "effect";

export const SignedIn = Schema.Struct({ token: Schema.String, expiresAt: Schema.Int });
export type SignedIn = typeof SignedIn.Type;
