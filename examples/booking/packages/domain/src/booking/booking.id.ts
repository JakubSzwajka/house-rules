import * as Schema from "effect/Schema";

export const BookingId = Schema.NonEmptyString.pipe(Schema.brand("BookingId"));
export type BookingId = typeof BookingId.Type;
