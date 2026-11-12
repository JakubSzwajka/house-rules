import * as Domain from "@alchemy.run/domain";
import { PartyId } from "@house-rules/stack";

export class NotMember extends Domain.Rejection(
  "NotMember",
  { person: PartyId },
  { httpApiStatus: 404 },
) {}
