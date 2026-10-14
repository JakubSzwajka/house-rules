import { type Actor, PerRequest } from "@house-rules/domain";
import { Context } from "effect";

export class CurrentActor extends Context.Service<CurrentActor, Actor>()(
  "@house-rules/application/CurrentActor",
) {
  declare readonly [PerRequest]: typeof PerRequest;
}
