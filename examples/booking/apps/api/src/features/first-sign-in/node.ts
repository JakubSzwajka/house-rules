import { bindLogin } from "@house-rules/identity/contract";
import { createPerson } from "@house-rules/party/contract";
import { defineNode } from "@house-rules/domain/contract";
import { Schema } from "effect";
export const firstSignInNode = defineNode("first_sign_in", {
  description: "Create a person and bind a verified login atomically.",
  title: "Create a person and bind a verified login atomically",
  permission: null,
  input: Schema.Struct({
    issuer: bindLogin.input.fields.issuer,
    subject: bindLogin.input.fields.subject,
    displayName: createPerson.input.fields.displayName,
  }),
  output: bindLogin.output,
  failure: Schema.Union([createPerson.failure, bindLogin.failure]),
  edges: [createPerson, bindLogin],
});
