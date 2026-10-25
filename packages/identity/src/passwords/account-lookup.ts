import type { ActorId } from "@house-rules/domain";
import { errorKind } from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";
import type { BindingStore } from "../storage.js";
import type { AccountStore } from "./account-store.js";
import type { PasswordIssuerService } from "./accounts-issuer.js";
import { normaliseEmail } from "./email.js";
import { AccountStoreUnavailable } from "./store-unavailable.js";

export class PasswordAccountNotFound extends Schema.TaggedError<PasswordAccountNotFound>()(
  "PasswordAccountNotFound",
  { kind: errorKind("not_found") },
) {
  override get message() {
    return "No bound password account was found.";
  }
}

export const makeAccountLookup = (
  accounts: AccountStore["Service"] | undefined,
  issuer: PasswordIssuerService | undefined,
  bindings: BindingStore["Service"],
) =>
  Effect.fn("Identity.accountByEmail")(function* (
    raw: string,
  ): Effect.fn.Return<
    { accountId: string; actorId: ActorId; displayName: string },
    PasswordAccountNotFound | AccountStoreUnavailable
  > {
    const email = normaliseEmail(raw);
    if (email === undefined || accounts === undefined || issuer === undefined) {
      return yield* new PasswordAccountNotFound();
    }
    const account = yield* accounts.findByEmail(email);
    if (account === undefined) return yield* new PasswordAccountNotFound();
    const actorId = yield* bindings
      .find({ issuer: issuer.issuer, subject: account.id })
      .pipe(Effect.mapError((cause) => new AccountStoreUnavailable({ cause })));
    if (actorId === undefined) return yield* new PasswordAccountNotFound();
    return { accountId: account.id, actorId, displayName: account.displayName };
  });
