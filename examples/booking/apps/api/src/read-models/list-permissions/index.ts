import { PartyOperations } from "@house-rules/party/contract";
import { defineReadModel } from "@house-rules/application/contract";
import { Effect, Schema } from "effect";
export const listPermissions = defineReadModel("list_permissions", {
  description: "List permissions declared by the app's operations.",
  input: PartyOperations.myAccess.input,
  output: Schema.Array(Schema.String),
  failure: PartyOperations.myAccess.failure,
  permission: null,
  edges: [PartyOperations.myAccess],
  handler: (input, { call }) =>
    call(PartyOperations.myAccess, input).pipe(Effect.map((access) => access.catalogue)),
});
