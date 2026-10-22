import { Identity } from "@house-rules/identity";
import { Features } from "../features/index.ts";
import { systemPermissions } from "./roles.ts";
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
import { Config, Context, Effect, Layer } from "effect";
export const newLoginHook = Layer.effect(
  FirstSignIn,
  Effect.gen(function* () {
    const issuer = yield* (yield* Identity).passwordIssuer();
    const adminEmail = yield* Config.String("DEMO_ADMIN_EMAIL").pipe(Config.withDefault(""));
    const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"));
    const runtime = yield* Runtime;
    const trace = yield* StepTrace;
    const unit = yield* UnitOfWork;
    const watch = yield* CallWatch;
    const context = Context.make(Runtime, runtime).pipe(
      Context.add(StepTrace, trace),
      Context.add(UnitOfWork, unit),
      Context.add(CallWatch, watch),
    );
    const permissions = May.system([Features.firstSignIn], {
      system: systemPermissions,
      via: "hook:new-login",
    });
    return (principal) =>
      runFeature(Features.firstSignIn, {
        issuer: principal.issuer,
        subject: principal.subject,
        displayName:
          typeof principal.claims.name === "string" ? principal.claims.name : principal.subject,
        admin:
          nodeEnv !== "production" &&
          adminEmail !== "" &&
          principal.issuer === issuer?.issuer &&
          principal.claims.email === adminEmail.trim().toLowerCase(),
      }).pipe(
        Effect.provideContext(Context.merge(context, permissions)),
        Effect.provide(Approval.allowAll),
        Effect.mapError(
          () => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." }),
        ),
      );
  }),
);
