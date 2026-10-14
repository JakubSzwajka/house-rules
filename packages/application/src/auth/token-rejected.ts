import { Schema } from "effect";

export const tokenRejectedReasons = [
  "invalid",
  "expired",
  "wrong_audience",
  "wrong_issuer",
  "unavailable",
] as const;

export type TokenRejectedReason = (typeof tokenRejectedReasons)[number];

export class TokenRejected extends Schema.TaggedError<TokenRejected>()("TokenRejected", {
  reason: Schema.Literals(tokenRejectedReasons),
}) {
  override get message(): string {
    return `Token rejected: ${this.reason}`;
  }
}
