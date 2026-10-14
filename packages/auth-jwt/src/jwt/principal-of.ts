import type { Principal } from "@house-rules/application";
import { Option, Predicate } from "effect";
import type { JWTPayload } from "jose";

const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter(Predicate.isString) : [];

const words = (value: string): ReadonlyArray<string> =>
  value.split(/\s+/u).filter((word) => word !== "");

const scopesOf = (payload: JWTPayload): ReadonlyArray<string> => {
  if (Predicate.isString(payload["scope"])) return words(payload["scope"]);
  const scp = payload["scp"];
  return Predicate.isString(scp) ? words(scp) : strings(scp);
};

const audienceOf = (aud: JWTPayload["aud"]): ReadonlyArray<string> =>
  aud === undefined ? [] : Predicate.isString(aud) ? [aud] : strings(aud);

export const principalOf = (payload: JWTPayload): Option.Option<Principal> =>
  Predicate.isString(payload.sub) && payload.sub !== ""
    ? Option.some({
        issuer: payload.iss ?? "",
        subject: payload.sub,
        audience: audienceOf(payload.aud),
        scopes: scopesOf(payload),
        claims: { ...payload },
      })
    : Option.none();
