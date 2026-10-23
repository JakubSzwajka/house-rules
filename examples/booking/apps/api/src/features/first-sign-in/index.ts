import { IdentityOperations } from "@house-rules/identity/contract";
import { PartyOperations } from "@house-rules/party/contract";
import { Effect, Schema } from "effect";
import { defineFeature } from "@house-rules/application/contract";
import { asSystem } from "@house-rules/domain/contract";
export const firstSignIn = defineFeature("first_sign_in", {
  description:
    "Create a person, bind login and assign member for every verified issuer, including remote MCP.",
  title: "Create a person and bind a verified login atomically",
  permission: null,
  input: Schema.Struct({
    issuer: IdentityOperations.bindLogin.input.fields.issuer,
    subject: IdentityOperations.bindLogin.input.fields.subject,
    displayName: PartyOperations.createPerson.input.fields.displayName,
  }),
  output: IdentityOperations.bindLogin.output,
  failure: Schema.Union([
    PartyOperations.createPerson.failure,
    IdentityOperations.bindLogin.failure,
    PartyOperations.assignRole.failure,
  ]),
  edges: [
    PartyOperations.createPerson,
    IdentityOperations.bindLogin,
    asSystem(PartyOperations.assignRole, "default role on first sign-in"),
  ],
  start: { kind: "system", reason: "new login", startedBy: "hook:new-login" },
  handler: (input, { call }) =>
    Effect.gen(function* () {
      const person = yield* call(PartyOperations.createPerson, {
        displayName: input.displayName,
      });
      yield* call(PartyOperations.assignRole, {
        personId: person.id,
        roleKey: "member",
        organisationId: null,
      });
      return yield* call(IdentityOperations.bindLogin, {
        issuer: input.issuer,
        subject: input.subject,
        personId: person.id,
      });
    }),
});
