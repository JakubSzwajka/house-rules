import { PartyOperations } from "@house-rules/party/contract";
import { defineFeature } from "@house-rules/application/contract";
const operation = PartyOperations.deleteRole;
export const deleteRole = defineFeature("delete_role", {
  description: "Delete a custom role.",
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  permission: null,
  edges: [operation],
  flags: { transactional: true },
  handler: (input, { call }) => call(operation, input),
});
