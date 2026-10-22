import { PartyOperations } from "@house-rules/party/contract";
import { defineFeature } from "@house-rules/application/contract";
const operation = PartyOperations.revokeInvitation;
export const revokeInvitation = defineFeature("revoke_invitation", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  flags: { transactional: true },
  handler: (input, { call }) => call(operation, input),
});
