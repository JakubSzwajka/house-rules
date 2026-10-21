import { Features, systemPermissions } from "../features/index.ts";
import {
  May,
  Runtime,
  StepTrace,
  Approval,
  CallWatch,
  Refused,
  runFeature,
} from "@house-rules/application";
import { UnitOfWork } from "@house-rules/domain";
import { FirstSignIn } from "@house-rules/identity";
import { Context, Effect, Layer } from "effect";
export const newLoginHook = Layer.effect(
  FirstSignIn,
  Effect.gen(function* () {
    const runtime = yield* Runtime;
    const trace = yield* StepTrace;
    const unit = yield* UnitOfWork;
    const watch = yield* CallWatch;
    const context = Context.make(Runtime, runtime).pipe(
      Context.add(StepTrace, trace),
      Context.add(UnitOfWork, unit),
      Context.add(CallWatch, watch),
    );
    const permissions = May.context(May.system([Features.firstSignIn]), {
      system: systemPermissions,
      via: "hook:new-login",
    });
    return (principal) =>
      runFeature(Features.firstSignIn, {
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
