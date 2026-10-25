import { IdentityOperations } from "@house-rules/identity/contract";
import { defineFeature } from "@house-rules/application/contract";
const operation = IdentityOperations.changePassword;
export const changePassword = defineFeature("change_password", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  flags: { transactional: true },
  handler: (input, { call }) => call(operation, input),
});
