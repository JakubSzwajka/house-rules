import { Option } from "effect";
import { Cookies } from "effect/http";
import type { Incoming } from "../delivery/caller.ts";

export type TokenSource = "bearer" | Readonly<{ cookie: string }>;

const bearerPattern = /^Bearer\s+(\S+)\s*$/iu;

export const tokenFrom = (incoming: Incoming, source: TokenSource): Option.Option<string> => {
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
