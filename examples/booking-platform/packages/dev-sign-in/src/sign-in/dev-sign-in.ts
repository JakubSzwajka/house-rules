import { defineContract } from "@house-rules/application/contract";
import { Schema } from "effect";

export const DevName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(60));
export type DevName = typeof DevName.Type;

export const DevToken = Schema.Struct({ token: Schema.String });
export type DevToken = typeof DevToken.Type;

export class DevSignInOff extends Schema.TaggedError<DevSignInOff>()("DevSignInOff", {}) {}

export const devSignInContract = defineContract("dev_sign_in", {
  description:
    "Dev and demos only: sign in by name and get a bearer token. The same name is the same person.",
  input: Schema.Struct({ name: DevName }),
  output: DevToken,
  failure: DevSignInOff,
  permission: "public",
});
