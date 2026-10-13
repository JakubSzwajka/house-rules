import { Schema } from "effect";

export const ActorId = Schema.NonEmptyString.pipe(Schema.brand("ActorId"));

export type ActorId = typeof ActorId.Type;

export const Actor = Schema.Struct({ id: ActorId });

export type Actor = typeof Actor.Type;
