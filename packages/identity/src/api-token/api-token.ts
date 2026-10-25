import { ActorId, errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const TokenId = Schema.String.check(Schema.isUUID());
export const TokenSummary = Schema.Struct({
  id: TokenId,
  actorId: ActorId,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(Schema.NonEmptyString),
  createdBy: ActorId,
  createdAt: Schema.Finite,
  lastUsedAt: Schema.NullOr(Schema.Finite),
  revokedAt: Schema.NullOr(Schema.Finite),
});
export type TokenSummary = typeof TokenSummary.Type;
export const TokenRow = Schema.Struct({
  ...TokenSummary.fields,
  lookup: Schema.String,
  secretHmac: Schema.String,
});
export type TokenRow = typeof TokenRow.Type;
export const IssueTokenInput = Schema.Struct({
  actorId: ActorId,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(Schema.NonEmptyString),
  createdBy: ActorId,
});
export type IssueTokenInput = typeof IssueTokenInput.Type;
export const TokenIssued = Schema.Struct({
  kind: Schema.Literal("identity.token_issued"),
  after: Schema.Struct({ name: Schema.String, scopes: Schema.Array(Schema.String) }),
});
export const TokenRevoked = Schema.Struct({
  kind: Schema.Literal("identity.token_revoked"),
  before: Schema.Struct({ revoked: Schema.Literal(false) }),
  after: Schema.Struct({ revoked: Schema.Literal(true) }),
});
export const IssuedToken = Schema.Struct({
  token: TokenSummary,
  secret: Schema.String,
  fact: TokenIssued,
});
export const RevokedToken = Schema.Struct({
  before: TokenSummary,
  after: TokenSummary,
  fact: TokenRevoked,
});
export class ApiTokensUnavailable extends Schema.TaggedError<ApiTokensUnavailable>()(
  "ApiTokensUnavailable",
  {
    kind: errorKind("unavailable"),
  },
) {
  override get message() {
    return "API tokens are unavailable. Try again shortly.";
  }
}
export class TokenInputInvalid extends Schema.TaggedError<TokenInputInvalid>()(
  "TokenInputInvalid",
  {
    kind: errorKind("invalid"),
  },
) {
  override get message() {
    return "Provide a token name and nonempty scope names.";
  }
}
export class TokenNotFound extends Schema.TaggedError<TokenNotFound>()("TokenNotFound", {
  kind: errorKind("not_found"),
  id: Schema.String,
}) {
  override get message() {
    return "The token was not found.";
  }
}

export const tokenSummary = ({
  lookup: _lookup,
  secretHmac: _secretHmac,
  ...summary
}: TokenRow): TokenSummary => summary;
