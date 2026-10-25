import { type Binding, bindOperation, CallRequestId } from "@house-rules/application";
import { Effect } from "effect";
import type { EventLogService } from "./event-log.js";
import { EventLogOperations as operations } from "./operations.js";

export const bindEventLog = (service: EventLogService): readonly Binding[] => [
  bindOperation(operations.record, (fact, { caller }) =>
    Effect.gen(function* () {
      const requestId = yield* CallRequestId;
      return yield* service.record(
        caller.kind === "person" ? caller.actor : null,
        fact,
        requestId || null,
      );
    }),
  ),
  bindOperation(operations.read, (query) => service.read(query)),
  bindOperation(operations.due, () => service.due()),
  bindOperation(operations.claimDue, (query) => service.claimDue(query)),
  bindOperation(operations.takeNext, (token) => service.takeNext(token)),
  bindOperation(operations.settleSuccess, (token) => service.settleSuccess(token)),
  bindOperation(operations.settleFailure, ({ token, lastError }) =>
    service.settleFailure(token, lastError),
  ),
  bindOperation(operations.listDeadLetters, (query) => service.listDeadLetters(query)),
  bindOperation(operations.replay, ({ consumer, eventId }) => service.replay(consumer, eventId)),
];
