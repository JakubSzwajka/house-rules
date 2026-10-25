import { PartyOperations } from "@house-rules/party/contract";
import { defineFeature } from "@house-rules/application/contract";
import { asSystem } from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";
export const acceptInvitation = defineFeature("accept_invitation", {
  description: "Join an organisation with a one-time invitation code.",
  permission: null,
  input: PartyOperations.acceptInvitation.input,
  output: PartyOperations.acceptInvitation.output,
  failure: Schema.Union([
    PartyOperations.acceptInvitation.failure,
    PartyOperations.assignRole.failure,
  ]),
  edges: [
    PartyOperations.acceptInvitation,
    asSystem(PartyOperations.assignRole, "role delegated by organisation invitation"),
  ],
  flags: { transactional: true },
  handler: (input, { call }) =>
    Effect.gen(function* () {
      const accepted = yield* call(PartyOperations.acceptInvitation, input);
      if (accepted.roleKey !== null)
        yield* call(PartyOperations.assignRole, { ...accepted, roleKey: accepted.roleKey });
      return accepted;
    }),
});
