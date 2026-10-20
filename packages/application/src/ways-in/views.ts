import type { ErrorKind, KindedError } from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";
import { Refused } from "./caller.ts";

export type WordingOverrides<E> = Readonly<{
  [Tag in E extends { readonly _tag: infer T extends string } ? T : never]?: (
    error: Extract<E, { readonly _tag: Tag }>,
  ) => string;
}>;
export type View = Readonly<{
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
  code?: string;
}>;
export const internalErrorView: View = {
  status: 500,
  body: { error: { code: "internal_error", message: "Something went wrong on the server." } },
};
export const kindStatuses: Readonly<Record<ErrorKind, number>> = {
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unavailable: 503,
  invalid: 400,
};

export const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined;

const publicMessage = (error: KindedError): string => {
  switch (error._tag) {
    case "Forbidden":
      return `You may not use ${"entry" in error ? error.entry : "this entry"}.`;
    case "ApprovalDenied":
      return "This action was not approved.";
    case "NoOpenUnit":
    case "UnitOfWorkFailed":
    case "SqlError":
    case "GraphInvalid":
    case "NodeCallInvalid":
    case "CompositionClosed":
      return "Try again shortly.";
    default:
      return error.message;
  }
};

const viewOfKind = (
  error: KindedError,
  kind: ErrorKind,
  overrides?: WordingOverrides<KindedError>,
): Effect.Effect<View> =>
  Effect.gen(function* () {
    const override =
      overrides !== undefined && Object.hasOwn(overrides, error._tag)
        ? overrides[error._tag]
        : undefined;
    const message = yield* Effect.sync(() =>
      override === undefined ? publicMessage(error) : override(error),
    );
    if (typeof message !== "string")
      return yield* Effect.die(new TypeError("A wording override must return a string"));
    return {
      status: kindStatuses[kind],
      code: kind,
      body: { error: { code: kind, message } },
    };
  });

export const safeViewOf = (
  overrides: Readonly<Record<string, unknown>> | undefined,
  error: unknown,
  protocol = false,
): Effect.Effect<View> =>
  Effect.gen(function* () {
    if (protocol && Schema.is(Refused)(error)) {
      if (!Number.isInteger(error.status) || error.status < 400 || error.status > 599)
        return internalErrorView;
      return {
        status: error.status === 500 ? 500 : error.status,
        body:
          error.status === 500
            ? internalErrorView.body
            : { error: { code: error.code, message: error.message } },
        ...(error.status === 500 || error.challenge === undefined
          ? {}
          : { headers: { "www-authenticate": error.challenge } }),
      };
    }
    if (
      tagOf(error) === "SqlError" &&
      typeof error === "object" &&
      error !== null &&
      !("kind" in error)
    )
      return yield* viewOfKind(
        error as KindedError,
        "unavailable",
        overrides as WordingOverrides<KindedError> | undefined,
      );
    if (
      typeof error !== "object" ||
      error === null ||
      !("kind" in error) ||
      typeof error.kind !== "string" ||
      !Object.hasOwn(kindStatuses, error.kind) ||
      !("message" in error) ||
      typeof error.message !== "string" ||
      tagOf(error) === undefined
    )
      return internalErrorView;
    return yield* viewOfKind(
      error as KindedError,
      error.kind as ErrorKind,
      overrides as WordingOverrides<KindedError> | undefined,
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("A wording override failed", cause).pipe(Effect.as(internalErrorView)),
    ),
  );
