import { PartyOperations } from "@house-rules/party/contract";
import { defineFeature } from "@house-rules/application/contract";
import { asSystem } from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";
export const createOrganisation = defineFeature("create_organisation", {
  description: "Create an organisation and become its scoped administrator.",
  permission: null,
  input: PartyOperations.createOrganisation.input,
  output: PartyOperations.createOrganisation.output,
  failure: Schema.Union([
    PartyOperations.createOrganisation.failure,
    PartyOperations.assignRole.failure,
  ]),
  edges: [
    PartyOperations.createOrganisation,
    asSystem(PartyOperations.assignRole, "creator of organisation"),
  ],
  flags: { transactional: true },
  handler: (input, { call, caller }) =>
    Effect.gen(function* () {
      const org = yield* call(PartyOperations.createOrganisation, input);
      if (caller.kind === "person")
        yield* call(PartyOperations.assignRole, {
          personId: caller.actor.id,
          roleKey: "org-admin",
          organisationId: org.id,
        });
      return org;
    }),
});
