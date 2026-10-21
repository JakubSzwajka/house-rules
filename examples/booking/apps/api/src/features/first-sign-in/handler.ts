import { bindLogin } from "@house-rules/identity/contract";
import { createPerson } from "@house-rules/party/contract";
import { bindNode } from "@house-rules/application";
import { Effect } from "effect";
import { firstSignInNode } from "./node.ts";
export const firstSignInNodeBinding = bindNode(firstSignInNode, (input, { call: callNode }) =>
  Effect.gen(function* () {
    const person = yield* callNode(createPerson, { displayName: input.displayName });
    return yield* callNode(bindLogin, {
      issuer: input.issuer,
      subject: input.subject,
      personId: person.id,
    });
  }),
);
