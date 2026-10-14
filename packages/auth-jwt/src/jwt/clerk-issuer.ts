import { Option, Result } from "effect";
import { Base64 } from "effect/encoding";

const keyPattern = /^pk_(?:test|live)_([A-Za-z0-9+/]+={0,2})$/u;
const hostPattern = /^([a-z0-9.-]+\.[a-z]{2,})\$$/iu;

const padded = (value: string) => value.padEnd(Math.ceil(value.length / 4) * 4, "=");

export const clerkIssuer = (publishableKey: string): Option.Option<string> => {
  const encoded = keyPattern.exec(publishableKey)?.[1];
  if (encoded === undefined) return Option.none();
  const decoded = Result.getOrUndefined(Base64.decodeString(padded(encoded)));
  const host = decoded === undefined ? undefined : hostPattern.exec(decoded)?.[1];
  return host === undefined ? Option.none() : Option.some(`https://${host.toLowerCase()}`);
};
