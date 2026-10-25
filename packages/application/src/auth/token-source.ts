import { Option } from "effect";
import { Cookies } from "effect/http";
import type { Incoming } from "./incoming.ts";

export type TokenPlace = "bearer" | Readonly<{ cookie: string }>;

export type TokenSource = TokenPlace | readonly [TokenPlace, ...ReadonlyArray<TokenPlace>];

const bearerPattern = /^Bearer\s+(\S+)\s*$/iu;

const fromPlace = (incoming: Incoming, source: TokenPlace): Option.Option<string> => {
  if (source === "bearer") {
    return Option.fromNullishOr(
      bearerPattern.exec(incoming.headers.get("authorization") ?? "")?.[1],
    );
  }
  const header = incoming.headers.get("cookie");
  if (header === null) return Option.none();
  const value = Cookies.parseHeader(header)[source.cookie];
  return value === undefined || value === "" ? Option.none() : Option.some(value);
};

export const tokenFrom = (incoming: Incoming, source: TokenSource): Option.Option<string> => {
  if (!Array.isArray(source)) return fromPlace(incoming, source as TokenPlace);
  // The first place that holds a token wins; a bad bearer never falls back to the cookie.
  for (const place of source as ReadonlyArray<TokenPlace>) {
    const token = fromPlace(incoming, place);
    if (Option.isSome(token)) return token;
  }
  return Option.none();
};
