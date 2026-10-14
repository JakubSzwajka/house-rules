import { Actor, ActorId } from "@house-rules/domain";
import { composition, CurrentActor, Grant } from "@house-rules/application";
import { Context, Effect, Layer, Option } from "effect";
import { appLayer } from "../../../composition/app-layer.js";
import { TokenVerifier } from "../../../composition/token-verifier.js";
import { bookingViews } from "../../../composition/views.js";
import { mcpAuthConfigOf } from "../config.js";

export const actorA = Actor.make({ id: ActorId.make("actor-a") });
export const actorB = Actor.make({ id: ActorId.make("actor-b") });

export const config = mcpAuthConfigOf("https://hosti.example", "https://id.example");

const tokens: Readonly<Record<string, Actor>> = { "tok-a": actorA, "tok-b": actorB };

export const fakeVerifier = Layer.succeed(TokenVerifier, {
  verify: (token, audience) =>
    Effect.succeed(
      audience === config?.resource ? Option.fromNullishOr(tokens[token]) : Option.none(),
    ),
});

export const appWithFakeVerifier = () =>
  composition({
    layer: Layer.merge(appLayer, fakeVerifier),
    caller: () =>
      Effect.succeed(
        Context.make(CurrentActor, actorA).pipe(
          Context.add(Grant, Grant.fromPermissions(["bookings:write", "comments:write"])),
        ),
      ),
    views: bookingViews,
  });
