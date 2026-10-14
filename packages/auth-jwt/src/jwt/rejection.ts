import type { TokenRejectedReason } from "@house-rules/application";
import { errors } from "jose";

export const rejectionReason = (error: unknown): TokenRejectedReason => {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "wrong_issuer";
    if (error.claim === "aud") return "wrong_audience";
    return "invalid";
  }
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    return "unavailable";
  }
  if (error instanceof errors.JOSEError) {
    // jose fails a JWKS fetch with a non-200 status or a body that is not JSON as a generic error.
    return error.code === "ERR_JOSE_GENERIC" ? "unavailable" : "invalid";
  }
  // Anything that is not a jose error comes from fetching the key set, such as a network failure.
  return "unavailable";
};
