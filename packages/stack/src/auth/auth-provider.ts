import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Headers from "effect/http/Headers";
import type * as Option from "effect/Option";
import type { Principal } from "./principal.ts";

export class AuthProvider extends Context.Service<
  AuthProvider,
  { readonly authenticate: (headers: Headers.Headers) => Effect.Effect<Option.Option<Principal>> }
>()("HouseRules/AuthProvider") {}
