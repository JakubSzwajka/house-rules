import { defineFeature } from "@house-rules/application/contract";
import { PartyOperations } from "@house-rules/party/contract";
export const assignRole = defineFeature("assign_role", {
  description: "Assign a role globally or in an organisation.",
  permission: null,
  input: PartyOperations.assignRole.input,
  output: PartyOperations.assignRole.output,
  failure: PartyOperations.assignRole.failure,
  edges: [PartyOperations.assignRole],
  handler: (input, { call }) => call(PartyOperations.assignRole, input),
});
