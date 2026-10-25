import { ActorId, defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { SessionControlUnavailable, SessionsPartlyEnded } from "./sessions.js";

export const SessionOperations = {
  endSessions: defineOperation("Identity.endSessions", {
    description: "End all provider sessions for an actor.",
    input: Schema.Struct({ actorId: ActorId }),
    output: Schema.Struct({ ended: Schema.Int }),
    failure: Schema.Union([SessionControlUnavailable, SessionsPartlyEnded]),
    permission: "identity:sessions-end",
    edges: [],
    transactional: true,
    destructive: true,
    needsApproval: true,
  }),
} as const;
