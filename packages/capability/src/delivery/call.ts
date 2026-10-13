import { Effect } from "effect";
import { requestIdHeader } from "../call/request-id.ts";
import { Approval } from "../gates/approval.ts";
import { type Admitted, admittedRequestId, resolvedFor } from "./admit.ts";
import type { Caller, Incoming } from "./caller.ts";
import { type Composition, serveIn } from "./composition.ts";
import {
  type ApprovalOption,
  closedFailure,
  type FailureOfCapability,
  inRequest,
  internalError,
  invoke,
  layerFailure,
  type Mountable,
  type Outcome,
  type SuccessOf,
} from "./invoke.ts";
import type { MountCheck } from "./mount-check.ts";
import { defaultViews, type ViewTable } from "./views.ts";

export type CallOptions<A> = Readonly<{
  approval?: ApprovalOption;
  channel?: string;
}> &
  (
    | Readonly<{ caller?: Caller<never, A>; admitted?: never }>
    | Readonly<{ caller?: never; admitted: Admitted }>
  );

export const call = <A, C, Views extends ViewTable<C>, Cap extends Mountable, E = never>(
  app: Composition<A, C, Views, E>,
  capability: Cap & MountCheck<Cap, A, C, Views, E>,
  input: Cap["contract"]["input"]["Encoded"],
  incoming: Incoming,
  options: CallOptions<A> = {},
): Promise<Outcome<SuccessOf<Cap>, FailureOfCapability<Cap> | E>> => {
  const views = { ...defaultViews, ...app.views };
  const kept =
    (options.admitted === undefined ? undefined : admittedRequestId(options.admitted)) ??
    incoming.headers.get(requestIdHeader);
  // Each branch makes its own request id: a built app's Random makes it inside the app runtime.
  const answered = serveIn(app, {
    ready: (context) =>
      Effect.gen(function* admittedCall() {
        if (options.caller !== undefined && options.admitted !== undefined) {
          return yield* Effect.die("caller and admitted cannot be combined");
        }
        const resolved =
          options.admitted === undefined ? undefined : yield* resolvedFor(app, options.admitted);
        return yield* invoke(context, capability, {
          incoming,
          // A server action's input is untrusted, so it decodes like a request body.
          input: Effect.succeed({ value: input, source: "json" }),
          channel: options.channel ?? resolved?.channel ?? "web",
          caller: options.caller ?? app.caller,
          ...(resolved === undefined ? {} : { resolved: resolved.context }),
          approval: options.approval,
          // A click in the app is the human's yes.
          defaultApproval: Approval.allowAll,
          views,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Delivery failed", cause).pipe(Effect.as(internalError)),
        ),
        inRequest(kept),
      ),
    failed: (cause) => layerFailure(views, cause).pipe(inRequest(kept)),
    closed: closedFailure(views).pipe(inRequest(kept)),
  });
  return Effect.runPromise(
    answered.pipe(
      Effect.annotateLogs("capability", capability.contract.name),
      Effect.map(([outcome]) => outcome as Outcome<SuccessOf<Cap>, FailureOfCapability<Cap> | E>),
    ),
  );
};
