import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { DeadLetter, DeadLetterQuery, Delivery, DeliveryToken, ReplayResult } from "./delivery.js";
import {
  DeadLetterNotFound,
  EventFact,
  EventInputInvalid,
  EventQuery,
  EventStoreUnavailable,
  StoredEvent,
} from "./event.js";
import { EventLogPermissions } from "./permissions.js";
const failure = Schema.Union([EventInputInvalid, EventStoreUnavailable]);
const consumer = Schema.Struct({ consumer: Schema.NonEmptyString });
const record = defineOperation("EventLog.record", {
  description: "Validate a domain fact and append its envelope to the transactional outbox.",
  input: EventFact,
  output: StoredEvent,
  failure,
  permission: EventLogPermissions.record,
  transactional: true,
});
const read = defineOperation("EventLog.read", {
  description: "Read event history in global cursor order.",
  input: EventQuery,
  output: Schema.Array(StoredEvent),
  failure,
  permission: EventLogPermissions.read,
  readOnly: true,
});
const due = defineOperation("EventLog.due", {
  description: "Select consumers whose next delivery is due. Results are hints, not claims.",
  input: Schema.Struct({}),
  output: Schema.Array(consumer),
  failure,
  permission: EventLogPermissions.deliver,
  readOnly: true,
});
const claimDue = defineOperation("EventLog.claimDue", {
  description:
    "Commit delivery attempts and exponential retry times in the selector unit before running handler items.",
  input: Schema.Struct({
    consumer: Schema.optionalKey(Schema.NonEmptyString),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
  }),
  output: Schema.Array(DeliveryToken),
  failure,
  permission: EventLogPermissions.deliver,
  transactional: true,
});
const takeNext = defineOperation("EventLog.takeNext", {
  description: "Lock a consumer until this handler unit ends. Ignore stale claimed attempts.",
  input: DeliveryToken,
  output: Schema.NullOr(Delivery),
  failure,
  permission: EventLogPermissions.deliver,
  transactional: true,
});
const settleSuccess = defineOperation("EventLog.settleSuccess", {
  description: "Advance a delivery cursor in the successful handler's unit.",
  input: DeliveryToken,
  output: Schema.Boolean,
  failure,
  permission: EventLogPermissions.deliver,
  transactional: true,
});
const settleFailure = defineOperation("EventLog.settleFailure", {
  description:
    "Optionally attach a safe failure summary in a fresh unit after handler rollback. Attempts and backoff already committed at claim.",
  input: Schema.Struct({ token: DeliveryToken, lastError: Schema.String }),
  output: Schema.Boolean,
  failure,
  permission: EventLogPermissions.deliver,
  transactional: true,
});
const listDeadLetters = defineOperation("EventLog.listDeadLetters", {
  description: "List dead letters per consumer, ordered by event cursor and consumer name.",
  input: DeadLetterQuery,
  output: Schema.Array(DeadLetter),
  failure,
  permission: EventLogPermissions.deadLetters,
  readOnly: true,
});
const replay = defineOperation("EventLog.replay", {
  description: "Manually enqueue one dead letter without rewinding the consumer cursor.",
  input: Schema.Struct({ consumer: Schema.NonEmptyString, eventId: DeliveryToken.fields.eventId }),
  output: ReplayResult,
  failure: Schema.Union([EventInputInvalid, EventStoreUnavailable, DeadLetterNotFound]),
  permission: EventLogPermissions.replay,
  transactional: true,
  needsApproval: true,
});
export const EventLogOperations = {
  record,
  read,
  due,
  claimDue,
  takeNext,
  settleSuccess,
  settleFailure,
  listDeadLetters,
  replay,
} as const;
