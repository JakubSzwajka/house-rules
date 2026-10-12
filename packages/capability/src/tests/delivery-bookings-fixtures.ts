import { Context, Effect, Layer, Schema } from "effect";

export const Booking = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  guestName: Schema.String,
  nights: Schema.Int,
});

export class BookingNotFound extends Schema.TaggedError<BookingNotFound>()("BookingNotFound", {
  id: Schema.String,
}) {}

export type Actor = Readonly<{ userId: string; scope: "read" | "write" }>;

export class Viewer extends Context.Service<Viewer, Actor>()("test/Viewer") {}

export type Work = { calls: number; callers: number };

type BookingRow = typeof Booking.Type;

export class Bookings extends Context.Service<
  Bookings,
  Readonly<{
    get: (actor: Actor, id: string) => Effect.Effect<BookingRow, BookingNotFound>;
    find: (
      actor: Actor,
      filter: Readonly<{ guest?: string; minNights?: number }>,
    ) => Effect.Effect<ReadonlyArray<BookingRow>>;
    cancel: (actor: Actor, id: string) => Effect.Effect<void, BookingNotFound>;
  }>
>()("test/Bookings") {
  static readonly fromRecords = (
    records: ReadonlyArray<BookingRow>,
    work: Work,
  ): Layer.Layer<Bookings> =>
    Layer.sync(Bookings, () => {
      const rows = new Map(records.map((row) => [row.id, row]));
      const visible = (actor: Actor, id: string): Effect.Effect<BookingRow, BookingNotFound> =>
        Effect.suspend(() => {
          work.calls += 1;
          const row = rows.get(id);
          return row !== undefined && row.owner === actor.userId
            ? Effect.succeed(row)
            : Effect.fail(new BookingNotFound({ id }));
        });
      return {
        get: visible,
        find: (actor, filter) =>
          Effect.sync(() => {
            work.calls += 1;
            return [...rows.values()].filter(
              (row) =>
                row.owner === actor.userId &&
                (filter.guest === undefined || row.guestName === filter.guest) &&
                (filter.minNights === undefined || row.nights >= filter.minNights),
            );
          }),
        cancel: (actor, id) =>
          visible(actor, id).pipe(
            Effect.tap(() => Effect.sync(() => rows.delete(id))),
            Effect.asVoid,
          ),
      };
    });
}
