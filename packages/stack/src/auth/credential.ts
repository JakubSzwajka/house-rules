import * as Cookies from "effect/http/Cookies";
import * as Headers from "effect/http/Headers";
import * as Option from "effect/Option";

export const credentialOf = (headers: Headers.Headers, cookie: string): Option.Option<string> =>
  Option.orElse(
    Option.flatMap(Headers.get(headers, "authorization"), (value) =>
      value.startsWith("Bearer ") ? Option.some(value.slice("Bearer ".length)) : Option.none(),
    ),
    () =>
      Option.flatMap(Headers.get(headers, "cookie"), (header) =>
        Option.fromNullishOr(Cookies.parseHeader(header)[cookie]),
      ),
  );
