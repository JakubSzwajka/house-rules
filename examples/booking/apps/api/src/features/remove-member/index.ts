import { PartyOperations } from "@house-rules/party/contract";
import { defineFeature } from "@house-rules/application/contract";
const operation = PartyOperations.unrelate;
export const removeMember = defineFeature("remove_member", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  flags: { transactional: true },
  handler: (input, { call }) => call(operation, input),
});
