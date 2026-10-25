import { defineFeature } from "@house-rules/application/contract";
import { PartyOperations } from "@house-rules/party/contract";
export const revokeRole = defineFeature("revoke_role", {
  description: "Revoke a role assignment.",
  permission: null,
  input: PartyOperations.revokeRole.input,
  output: PartyOperations.revokeRole.output,
  failure: PartyOperations.revokeRole.failure,
  edges: [PartyOperations.revokeRole],
  handler: (input, { call }) => call(PartyOperations.revokeRole, input),
});
