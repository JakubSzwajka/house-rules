import { Predicate } from "effect";

export type ClerkKind = "session" | "oauth_access" | "machine" | "unknown";

export const clerkKind = (
  header: Readonly<Record<string, unknown>>,
  claims: Readonly<Record<string, unknown>>,
): ClerkKind => {
  if (header["typ"] === "at+jwt" || header["typ"] === "application/at+jwt") {
    return "oauth_access";
  }
  const subject = claims["sub"];
  if (Predicate.isString(subject) && subject.startsWith("mch_")) return "machine";
  return (header["typ"] === undefined || header["typ"] === "JWT") &&
    Predicate.isString(subject) &&
    subject.startsWith("user_") &&
    Predicate.isString(claims["sid"]) &&
    claims["sid"] !== "" &&
    !Object.hasOwn(claims, "act")
    ? "session"
    : "unknown";
};
