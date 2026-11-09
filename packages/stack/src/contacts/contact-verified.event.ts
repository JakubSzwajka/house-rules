import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor } from "../actor/actor.ts";

export class ContactVerified extends Domain.Event("ContactVerified", {
  contactId: Schema.String,
  by: Schema.String,
  for: ActedFor,
}) {}
