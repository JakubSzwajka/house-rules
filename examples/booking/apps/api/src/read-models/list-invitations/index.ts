import { PartyOperations } from "@house-rules/party/contract";
import { defineReadModel } from "@house-rules/application/contract";
const operation = PartyOperations.listInvitations;
export const listInvitations = defineReadModel("list_invitations", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  handler: (input, { call }) => call(operation, input),
});
