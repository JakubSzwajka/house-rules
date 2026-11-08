import * as Domain from "@alchemy.run/domain";
import { PersonId } from "../actor/actor.ts";

export class NotMember extends Domain.Rejection(
  "NotMember",
  { person: PersonId },
  { httpApiStatus: 404 },
) {}
