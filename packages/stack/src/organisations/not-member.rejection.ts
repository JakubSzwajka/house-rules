import * as Domain from "@alchemy.run/domain";
import { PartyId } from "../actor/actor.ts";

export class NotMember extends Domain.Rejection(
  "NotMember",
  { person: PartyId },
  { httpApiStatus: 404 },
) {}
