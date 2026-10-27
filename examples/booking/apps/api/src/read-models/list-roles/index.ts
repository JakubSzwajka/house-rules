import { defineReadModel } from "@house-rules/application/contract";
import { PartyOperations } from "@house-rules/party/contract";
export const listRoles = defineReadModel("list_roles", {
  description: "List built-in and custom roles.",
  permission: null,
  input: PartyOperations.listRoles.input,
  output: PartyOperations.listRoles.output,
  failure: PartyOperations.listRoles.failure,
  edges: [PartyOperations.listRoles],
  handler: (input, { call }) => call(PartyOperations.listRoles, input),
});
