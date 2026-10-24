import { ActorId, defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { IdentityStoreUnavailable } from "../availability/store-unavailable.js";
import {
  ApiTokensUnavailable,
  IssueTokenInput,
  IssuedToken,
  RevokedToken,
  TokenId,
  TokenInputInvalid,
  TokenNotFound,
  TokenSummary,
} from "./api-token.js";
const failure = Schema.Union([IdentityStoreUnavailable, ApiTokensUnavailable]);
export const TokenOperations = {
  issueToken: defineOperation("Identity.issueToken", {
    description: "Issue a scoped opaque token for an explicitly authorized actor.",
    input: IssueTokenInput,
    output: IssuedToken,
    failure: Schema.Union([IdentityStoreUnavailable, ApiTokensUnavailable, TokenInputInvalid]),
    permission: "identity:tokens-issue",
    edges: [],
    transactional: true,
  }),
  listTokens: defineOperation("Identity.listTokens", {
    description: "List token summaries without secrets.",
    input: Schema.Struct({ actorId: Schema.optionalKey(ActorId) }),
    output: Schema.Array(TokenSummary),
    failure,
    permission: "identity:tokens-read",
    edges: [],
    readOnly: true,
  }),
  revokeToken: defineOperation("Identity.revokeToken", {
    description: "Revoke a token, returning its change once.",
    input: Schema.Struct({ id: TokenId }),
    output: Schema.NullOr(RevokedToken),
    failure: Schema.Union([IdentityStoreUnavailable, ApiTokensUnavailable, TokenNotFound]),
    permission: "identity:tokens-revoke",
    edges: [],
    transactional: true,
    destructive: true,
    needsApproval: true,
  }),
  recordTokenUse: defineOperation("Identity.recordTokenUse", {
    description: "Flush buffered token use timestamps inside a unit.",
    input: Schema.Struct({}),
    output: Schema.Void,
    failure,
    permission: "identity:tokens-use",
    edges: [],
    transactional: true,
  }),
} as const;
