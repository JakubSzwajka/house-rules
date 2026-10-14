import { BookingPermissions, Bookings } from "@hosti/bookings";
import { memoryUnitOfWork } from "@house-rules/domain";
import { Grant } from "@house-rules/application";
import { Comments, CommentTargets, CommentTargetsUnavailable } from "@house-rules/comments";
import { Effect, Layer } from "effect";

export const visitorGrant: Layer.Layer<Grant> = Grant.layerFromPermissions([
  BookingPermissions.read,
]);

export const commentTargets = Layer.effect(
  CommentTargets,
  Effect.gen(function* () {
    const bookings = yield* Bookings;
    return CommentTargets.of({
      relation: (actor, ref) =>
        bookings
          .relation(actor, ref.id)
          .pipe(Effect.mapError((cause) => new CommentTargetsUnavailable({ cause }))),
    });
  }),
);

export const appLayer = Layer.mergeAll(
  Comments.layerMemory({ ...Comments.presets.default, targets: ["booking"] }).pipe(
    Layer.provide(commentTargets),
    Layer.provideMerge(Bookings.fromRecords([])),
  ),
  memoryUnitOfWork,
  visitorGrant,
);
