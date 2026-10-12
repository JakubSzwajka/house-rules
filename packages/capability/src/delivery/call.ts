import { Effect } from "effect";
import { requestIdHeader } from "../call/request-id.ts";
import { Approval } from "../gates/approval.ts";
import type { Caller, Incoming } from "./caller.ts";
import type { Composition } from "./composition.ts";
import {
  type ApprovalOption,
  type FailureOfCapability,
  inRequest,
  invoke,
  type Mountable,
  type Outcome,
  type SuccessOf,
} from "./invoke.ts";
import type { MountCheck } from "./mount-check.ts";
import { defaultViews, type ViewTable } from "./views.ts";

export type CallOptions<A> = Readonly<{
  caller?: Caller<never, A>;
  approval?: ApprovalOption;
  channel?: string;
}>;

export const call = <A, C, Views extends ViewTable<C>, Cap extends Mountable>(
  app: Composition<A, C, Views>,
  capability: Cap & MountCheck<Cap, A, C, Views>,
  input: Cap["contract"]["input"]["Encoded"],
  incoming: Incoming,
  options: CallOptions<A> = {},
): Promise<Outcome<SuccessOf<Cap>, FailureOfCapability<Cap>>> =>
  app.runtime.runPromise(
    invoke(app, capability, {
      incoming,
      // A server action's input is untrusted, so it decodes like a request body.
      input: Effect.succeed({ value: input, source: "json" }),
      channel: options.channel ?? "web",
      caller: options.caller ?? app.caller,
      approval: options.approval,
      // A click in the app is the human's yes.
      defaultApproval: Approval.allowAll,
      views: { ...defaultViews, ...app.views },
    }).pipe(
      inRequest(incoming.headers.get(requestIdHeader)),
      Effect.map(([outcome]) => outcome as Outcome<SuccessOf<Cap>, FailureOfCapability<Cap>>),
    ),
  );
