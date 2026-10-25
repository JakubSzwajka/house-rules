import { defineFeature } from "@house-rules/application/contract";
import { PartyOperations } from "@house-rules/party/contract";
export const defineRole = defineFeature("define_role", {
  description: "Define a custom role from the app permission catalogue.",
  permission: null,
  input: PartyOperations.defineRole.input,
  output: PartyOperations.defineRole.output,
  failure: PartyOperations.defineRole.failure,
  edges: [PartyOperations.defineRole],
  handler: (input, { call }) => call(PartyOperations.defineRole, input),
});
