import { IdentityOperations } from "@house-rules/identity/contract";
import { defineFeature, systemStart } from "@house-rules/application/contract";
const operation = IdentityOperations.signUp;
export const signUp = defineFeature("sign_up", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  flags: { transactional: true },
  start: systemStart("public sign_up"),
  handler: (input, { call }) => call(operation, input),
});
