import * as Domain from "@alchemy.run/domain";
import { Actor } from "./actor.ts";

export class CurrentActor extends Domain.RequestContext<CurrentActor>()(
  "HouseRules/CurrentActor",
  Actor,
) {}
