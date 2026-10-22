import { PartyOperations } from "@house-rules/party/contract";
import { defineFeature } from "@house-rules/application/contract";
const operation = PartyOperations.listMembers;
export const listMembers = defineFeature("list_members", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  flags: { readOnly: true },
  handler: (input, { call }) => call(operation, input),
});
