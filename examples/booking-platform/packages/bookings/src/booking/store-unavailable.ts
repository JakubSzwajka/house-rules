import { Schema } from "effect";

export class BookingStoreUnavailable extends Schema.TaggedError<BookingStoreUnavailable>()(
  "BookingStoreUnavailable",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
