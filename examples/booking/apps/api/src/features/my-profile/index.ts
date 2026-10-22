import { PartyOperations } from "@house-rules/party/contract";
import { defineFeature } from "@house-rules/application/contract";
import { Effect, Schema } from "effect";
export const myProfile = defineFeature("my_profile", {
  description: "Read your person, held roles and effective permissions.",
  input: PartyOperations.showMe.input,
  output: Schema.Struct({
    person: PartyOperations.showMe.output,
    access: PartyOperations.myAccess.output,
  }),
  failure: Schema.Union([PartyOperations.showMe.failure, PartyOperations.myAccess.failure]),
  permission: null,
  edges: [PartyOperations.showMe, PartyOperations.myAccess],
  flags: { readOnly: true },
  handler: (input, { call }) =>
    Effect.gen(function* () {
      const person = yield* call(PartyOperations.showMe, input);
      const access = yield* call(PartyOperations.myAccess, input);
      return { person, access };
    }),
});
