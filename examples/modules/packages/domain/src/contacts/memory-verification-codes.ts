import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import { CodeInvalid, VerificationCodes } from "./verification-codes.external.ts";

export interface SentCode {
  readonly book: string;
  readonly contactId: string;
  readonly address: string;
  readonly code: string;
}

export const memoryVerificationCodes = (
  options: {
    readonly ttl?: Duration.Input;
    readonly deliver?: (sent: SentCode) => Effect.Effect<void>;
  } = {},
) =>
  VerificationCodes.toLayer(
    Effect.sync(() => {
      const ttl = Duration.toMillis(Duration.fromInputUnsafe(options.ttl ?? "30 minutes"));
      const deliver = options.deliver ?? ((sent) => Effect.logInfo("verification code", sent));
      const codes = new Map<string, SentCode & { readonly expiresAt: number }>();
      return {
        send: Effect.fn(function* ({ book, contactId, address }) {
          for (const [code, held] of codes)
            if (held.book === book && held.contactId === contactId) codes.delete(code);
          const code = String(yield* Random.nextIntBetween(100_000, 999_999));
          const sent = { book, contactId, address, code };
          codes.set(sent.code, { ...sent, expiresAt: (yield* Clock.currentTimeMillis) + ttl });
          yield* deliver(sent);
        }),
        check: Effect.fn(function* ({ code }) {
          const held = codes.get(code);
          codes.delete(code);
          if (!held || held.expiresAt <= (yield* Clock.currentTimeMillis))
            return yield* new CodeInvalid();
          return { book: held.book, contactId: held.contactId, address: held.address };
        }),
      };
    }),
  );
