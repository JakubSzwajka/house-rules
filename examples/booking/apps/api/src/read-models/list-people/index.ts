import { PartyOperations } from "@house-rules/party/contract";
import { defineReadModel } from "@house-rules/application/contract";
const operation = PartyOperations.listPeople;
export const listPeople = defineReadModel("list_people", {
  description: operation.description,
  permission: null,
  input: operation.input,
  output: operation.output,
  failure: operation.failure,
  edges: [operation],
  handler: (input, { call }) => call(operation, input),
});
