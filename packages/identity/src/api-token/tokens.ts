import { TokenRejected } from "@house-rules/application";
import type { ActorId, NoOpenUnit } from "@house-rules/domain";
import { UnitOfWork } from "@house-rules/domain";
import { Clock, Context, Crypto, Effect, Redacted, Result, Schema } from "effect";
import * as Hex from "effect/encoding/Hex";
import { IdentityStoreUnavailable } from "../storage.js";
import {
  ApiTokensUnavailable,
  IssueTokenInput,
  TokenId,
  TokenInputInvalid,
  TokenNotFound,
  tokenSummary,
  type TokenRow,
  type IssuedToken,
  type RevokedToken,
  type TokenSummary,
} from "./api-token.js";
import type { ApiTokenStore } from "./token-store.js";

export type ApiTokensProvider = Readonly<{
  kind: "apiTokens";
  prefix: string;
  hmacKey: Redacted.Redacted<string>;
}>;
export const apiTokens = (options: Omit<ApiTokensProvider, "kind">): ApiTokensProvider => ({
  ...options,
  kind: "apiTokens",
});
const crypto = Crypto.make({
  randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
  digest: (algorithm, bytes) =>
    Effect.promise(() => globalThis.crypto.subtle.digest(algorithm, new Uint8Array(bytes))).pipe(
      Effect.map((buffer) => new Uint8Array(buffer)),
    ),
});
const randomHex = (size: number) =>
  Hex.encode(globalThis.crypto.getRandomValues(new Uint8Array(size)));

export const makeApiTokens = Effect.fnUntraced(function* (
  options: ApiTokensProvider,
  store: ApiTokenStore["Service"],
) {
  const key = yield* Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(Redacted.value(options.hmacKey)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
    catch: (cause) => new IdentityStoreUnavailable({ cause }),
  });
  const message = (secret: string) => new TextEncoder().encode(`token:${secret}`);
  const sign = (secret: string) =>
    Effect.tryPromise({
      try: () => globalThis.crypto.subtle.sign("HMAC", key, message(secret)),
      catch: (cause) => new IdentityStoreUnavailable({ cause }),
    }).pipe(Effect.map((buffer) => Hex.encode(new Uint8Array(buffer))));
  // Who cannot write. Bound the buffer and flush it only inside an explicit unit.
  const used = new Map<string, number>();
  const bufferUse = (id: string, at: number) => {
    if (!used.has(id) && used.size >= 1000) {
      const oldest = used.keys().next().value;
      if (oldest !== undefined) used.delete(oldest);
    }
    used.set(id, Math.max(used.get(id) ?? 0, at));
  };
  const verify = Effect.fnUntraced(function* (token: string) {
    const suffix = token.slice(options.prefix.length);
    const match = /^([0-9a-f]{16})_([0-9a-f]{64})$/u.exec(suffix);
    if (!token.startsWith(options.prefix) || match?.[1] === undefined || match[2] === undefined)
      return yield* new TokenRejected({ reason: "invalid" });
    const row = yield* store.find(match[1]);
    const digest = Hex.decode(row?.secretHmac ?? "00".repeat(32));
    const bytes =
      Result.isSuccess(digest) && digest.success.length === 32
        ? digest.success
        : new Uint8Array(32);
    // WebCrypto's verify is constant-time. Unknown lookups do the same HMAC work.
    const matches = yield* Effect.tryPromise({
      try: () =>
        globalThis.crypto.subtle.verify(
          "HMAC",
          key,
          new Uint8Array(bytes),
          message(match[2] ?? ""),
        ),
      catch: (cause) => new IdentityStoreUnavailable({ cause }),
    });
    if (row === undefined || !matches || row.revokedAt !== null)
      return yield* new TokenRejected({ reason: "invalid" });
    const at = yield* Clock.currentTimeMillis;
    bufferUse(row.id, at);
    return { actorId: row.actorId, scopes: row.scopes };
  });
  return {
    verify,
    issueToken: Effect.fnUntraced(function* (input: IssueTokenInput) {
      yield* UnitOfWork.required;
      if (
        !Schema.is(IssueTokenInput)(input) ||
        input.name.trim() === "" ||
        input.scopes.some((scope) => scope.trim() === "")
      )
        return yield* new TokenInputInvalid();
      const secret = randomHex(32);
      const row: TokenRow = {
        ...input,
        scopes: [...new Set(input.scopes)],
        id: yield* crypto
          .randomUUIDv4()
          .pipe(Effect.mapError((cause) => new IdentityStoreUnavailable({ cause }))),
        lookup: randomHex(8),
        secretHmac: yield* sign(secret),
        createdAt: yield* Clock.currentTimeMillis,
        lastUsedAt: null,
        revokedAt: null,
      };
      yield* store.insert(row);
      const token = tokenSummary(row);
      return {
        token,
        secret: `${options.prefix}${row.lookup}_${secret}`,
        fact: {
          kind: "identity.token_issued" as const,
          after: { name: token.name, scopes: token.scopes },
        },
      };
    }),
    listTokens: (actorId?: ActorId) =>
      store.list(actorId).pipe(Effect.map((rows) => rows.map(tokenSummary))),
    revokeToken: Effect.fnUntraced(function* (id: string) {
      yield* UnitOfWork.required;
      if (!Schema.is(TokenId)(id)) return yield* new TokenNotFound({ id });
      const change = yield* store.revoke(id, yield* Clock.currentTimeMillis);
      if (change === undefined) return yield* new TokenNotFound({ id });
      if (change === null) return null;
      return {
        before: tokenSummary(change.before),
        after: tokenSummary(change.after),
        fact: {
          kind: "identity.token_revoked" as const,
          before: { revoked: false as const },
          after: { revoked: true as const },
        },
      };
    }),
    recordTokenUse: Effect.fnUntraced(function* () {
      yield* UnitOfWork.required;
      const batch = [...used];
      for (const [id, at] of batch) yield* store.recordUse(id, at);
      // On rollback restore the batch without discarding more recent admissions.
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          for (const [id, at] of batch) bufferUse(id, at);
        }),
      );
      for (const [id, at] of batch) if (used.get(id) === at) used.delete(id);
    }),
  };
});
type TokenFailure = IdentityStoreUnavailable | ApiTokensUnavailable;
export type TokenMethods = {
  issueToken: (
    input: IssueTokenInput,
  ) => Effect.Effect<typeof IssuedToken.Type, TokenFailure | TokenInputInvalid | NoOpenUnit>;
  listTokens: (actorId?: ActorId) => Effect.Effect<ReadonlyArray<TokenSummary>, TokenFailure>;
  revokeToken: (
    id: string,
  ) => Effect.Effect<typeof RevokedToken.Type | null, TokenFailure | TokenNotFound | NoOpenUnit>;
  recordTokenUse: () => Effect.Effect<void, TokenFailure | NoOpenUnit>;
};
export class ApiTokens extends Context.Service<
  ApiTokens,
  Effect.Success<ReturnType<typeof makeApiTokens>>
>()("@house-rules/identity/ApiTokens") {}
export const unavailableTokenMethods: TokenMethods = {
  issueToken: () => Effect.fail(new ApiTokensUnavailable()),
  listTokens: () => Effect.fail(new ApiTokensUnavailable()),
  revokeToken: () => Effect.fail(new ApiTokensUnavailable()),
  recordTokenUse: () => Effect.fail(new ApiTokensUnavailable()),
};
