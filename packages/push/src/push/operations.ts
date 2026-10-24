import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  PushOwner,
  PushPayload,
  PushSendFailed,
  PushTtl,
  PushSubscription,
  PushInputInvalid,
  PushSubscriptionConflict,
  PushSubscriptionNotFound,
  PushStoreUnavailable,
  Subscribed,
  Unsubscribed,
  SubscriptionExpired,
} from "./push.js";
import { PushPermissions } from "./permissions.js";
const subscribe = defineOperation("Push.subscribe", {
  description: "Subscribe the explicit person to a push endpoint.",
  input: Schema.Struct({
    endpoint: Schema.String,
    keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
    userAgent: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({ subscription: PushSubscription, events: Schema.Array(Subscribed) }),
  failure: Schema.Union([
    PushInputInvalid,
    PushSubscriptionConflict,
    PushSubscriptionNotFound,
    PushStoreUnavailable,
  ]),
  permission: PushPermissions.write,
  edges: [],
  transactional: true,
});
const unsubscribe = defineOperation("Push.unsubscribe", {
  description: "Remove one of the caller's push subscriptions.",
  input: Schema.Struct({ endpoint: Schema.NonEmptyString }),
  output: Schema.Struct({ events: Schema.Array(Unsubscribed) }),
  failure: Schema.Union([PushSubscriptionNotFound, PushStoreUnavailable]),
  permission: PushPermissions.write,
  edges: [],
  transactional: true,
  destructive: true,
});
const listMine = defineOperation("Push.listMine", {
  description: "List the caller's push subscriptions.",
  input: Schema.Struct({}),
  output: Schema.Array(PushSubscription),
  failure: PushStoreUnavailable,
  permission: PushPermissions.read,
  edges: [],
  readOnly: true,
});
const isSubscribed = defineOperation("Push.isSubscribed", {
  description: "Check whether the caller owns a push endpoint.",
  input: Schema.Struct({ endpoint: Schema.NonEmptyString }),
  output: Schema.Boolean,
  failure: PushStoreUnavailable,
  permission: PushPermissions.read,
  edges: [],
  readOnly: true,
});
const subscriptionsFor = defineOperation("Push.subscriptionsFor", {
  description: "List push subscriptions for a party owner.",
  input: Schema.Struct({ owner: PushOwner }),
  output: Schema.Array(PushSubscription),
  failure: PushStoreUnavailable,
  permission: PushPermissions.deliver,
  edges: [],
  readOnly: true,
});
const forgetExpired = defineOperation("Push.forgetExpired", {
  description: "Forget an endpoint rejected as expired by the push service.",
  input: Schema.Struct({ endpoint: Schema.NonEmptyString }),
  output: Schema.Struct({ events: Schema.Array(SubscriptionExpired) }),
  failure: PushStoreUnavailable,
  permission: PushPermissions.deliver,
  edges: [],
  transactional: true,
});
const deliver = defineOperation("Push.deliver", {
  description: "Send a push payload to an owner's active subscriptions as system.",
  input: Schema.Struct({
    owner: PushOwner,
    payload: PushPayload,
    idempotencyKey: Schema.NonEmptyString,
    ttl: Schema.optionalKey(PushTtl),
  }),
  output: Schema.Struct({
    sent: Schema.Int,
    expired: Schema.Int,
    events: Schema.Array(SubscriptionExpired),
  }),
  failure: Schema.Union([
    PushInputInvalid,
    PushSubscriptionNotFound,
    PushStoreUnavailable,
    PushSendFailed,
  ]),
  permission: PushPermissions.deliver,
  edges: [],
  transactional: true,
});
export const PushOperations = {
  subscribe,
  unsubscribe,
  listMine,
  isSubscribed,
  subscriptionsFor,
  forgetExpired,
  deliver,
} as const;
