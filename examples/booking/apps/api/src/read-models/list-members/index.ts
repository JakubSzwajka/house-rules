import { PartyOperations } from "@house-rules/party/contract";
import { defineReadModel } from "@house-rules/application/contract";
const operation = PartyOperations.listMembers;
export const listMembers = defineReadModel("list_members", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  handler: (input, { call }) => call(operation, input),
});
