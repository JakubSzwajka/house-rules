import { defineContract } from "@house-rules/application/contract";
import { Schema } from "effect";

export const signOutContract = defineContract("sign_out", {
  description:
    "End this browser's session. Tokens are not stored, so a copied token stays valid until it expires.",
  input: Schema.Struct({}),
  output: Schema.Struct({}),
  failure: Schema.Never,
  permission: "public",
});
