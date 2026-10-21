import { Entries, systemPermissions } from "./entries.ts";
import {
  May,
  NodeRuntime,
  StepTrace,
  Approval,
  CallWatch,
  Refused,
  runEntry,
} from "@house-rules/application";
import { UnitOfWork } from "@house-rules/domain";
import { FirstSignIn } from "@house-rules/identity";
import { Context, Effect, Layer } from "effect";
export const newLoginHook = Layer.effect(
  FirstSignIn,
  Effect.gen(function* () {
    const runtime = yield* NodeRuntime;
    const trace = yield* StepTrace;
    const unit = yield* UnitOfWork;
    const watch = yield* CallWatch;
    const context = Context.make(NodeRuntime, runtime).pipe(
      Context.add(StepTrace, trace),
      Context.add(UnitOfWork, unit),
      Context.add(CallWatch, watch),
    );
    const permissions = May.context(May.system([Entries.firstSignIn]), {
      system: systemPermissions,
      via: "hook:new-login",
    });
    return (principal) =>
      runEntry(Entries.firstSignIn, {
        issuer: principal.issuer,
        subject: principal.subject,
        displayName: principal.subject,
      }).pipe(
        Effect.provideContext(Context.merge(context, permissions)),
        Effect.provide(Approval.allowAll),
        Effect.mapError(
          () => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." }),
        ),
      );
  }),
);
