import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { ContactBook } from "./contact-book.aggregate.ts";
import { VerificationRequested } from "./request-verification.command.ts";
import { VerificationCodes } from "./verification-codes.external.ts";

export class VerificationDelivery extends Domain.Policy("VerificationDelivery", {
  from: ContactBook,
  on: [VerificationRequested],
}) {}

export const VerificationDeliveryLive = VerificationDelivery.toLayer(
  Effect.gen(function* () {
    const codes = yield* VerificationCodes;
    return Effect.fn(function* ({ source, event }) {
      yield* codes
        .send({
          book: source.id,
          contactId: event.contactId,
          address: event.address,
          type: event.type,
        })
        .pipe(
          Effect.catchTag("VerificationNotSent", ({ reason }) =>
            Effect.logWarning("verification not sent", { contactId: event.contactId, reason }),
          ),
        );
    });
  }),
);
