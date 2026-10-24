import type { ActorId } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { SessionControlUnavailable, SessionsPartlyEnded } from "./sessions.js";

export class SessionControl extends Context.Service<
  SessionControl,
  {
    endAll: (
      actorId: ActorId,
    ) => Effect.Effect<{ ended: number }, SessionControlUnavailable | SessionsPartlyEnded>;
  }
>()("@house-rules/identity/SessionControl") {}
