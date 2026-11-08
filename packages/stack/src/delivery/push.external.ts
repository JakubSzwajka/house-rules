import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

const filled = Schema.String.check(Schema.isPattern(/\S/));

export const PushEndpoint = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/));

export const PushSubscription = Schema.Struct({
  endpoint: PushEndpoint,
  keys: Schema.Struct({ p256dh: filled, auth: filled }),
});
export type PushSubscription = typeof PushSubscription.Type;

export class PushGone extends Schema.TaggedError<PushGone>()("PushGone", {}) {}

export class PushSendFailed extends Schema.TaggedError<PushSendFailed>()("PushSendFailed", {}) {}

export const PushMessage = Schema.Struct({
  subscription: PushSubscription,
  payload: Schema.Json,
  ttl: Schema.Int.check(Schema.isGreaterThan(0)),
  idempotencyKey: filled,
});
export type PushMessage = typeof PushMessage.Type;

export class Push extends Domain.ExternalSystem("Push", {
  send: {
    args: PushMessage.fields,
    error: [PushGone, PushSendFailed],
  },
}) {}
