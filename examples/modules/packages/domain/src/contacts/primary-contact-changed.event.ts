import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { ActedFor } from "@house-rules/stack";

export class PrimaryContactChanged extends Domain.Event("PrimaryContactChanged", {
  contactId: Schema.String,
  previous: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  by: Schema.String,
  for: ActedFor,
}) {}
