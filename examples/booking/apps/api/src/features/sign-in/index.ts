import { IdentityOperations } from "@house-rules/identity/contract";
import { defineFeature, systemStart } from "@house-rules/application/contract";
const operation = IdentityOperations.signIn;
export const signIn = defineFeature("sign_in", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  flags: { transactional: true },
  start: systemStart("public sign_in"),
  handler: (input, { call }) => call(operation, input),
});
