import { type Context, Effect } from "effect";
import type { ApprovalDenied, Forbidden } from "../gates/gate-errors.ts";
import type { NoOpenUnit, UnitOfWorkFailed } from "../unit-of-work/unit-of-work.ts";
import type { Refused } from "./caller.ts";
import type { InputInvalid } from "./input.ts";

export type View = Readonly<{
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
}>;

export type CallerContext<C> = Context.Context<C> | undefined;

export type ViewFn<C = never> = (error: never, caller: CallerContext<C>) => View;

export type ViewTable<C = never> = Readonly<Record<string, ViewFn<C>>>;

export const problem = (
  status: number,
  code: string,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
): View => ({ status, body: { error: { code, message, ...extra } } });

export const internalErrorView: View = problem(
  500,
  "internal_error",
  "Something went wrong on the server.",
);

export const defaultViews = {
  Refused: (error: Refused): View => ({
    ...problem(error.status, error.code, error.message),
    ...(error.challenge === undefined ? {} : { headers: { "www-authenticate": error.challenge } }),
  }),
  InputInvalid: (error: InputInvalid): View =>
    problem(400, "invalid_input", error.message, { field: error.field }),
  Forbidden: (error: Forbidden): View =>
    problem(403, "forbidden", `You may not use ${error.capabilityName}.`),
  ApprovalDenied: (error: ApprovalDenied): View =>
    problem(403, "approval_denied", `${error.capabilityName} was not approved: ${error.reason}.`),
  UnitOfWorkFailed: (_error: UnitOfWorkFailed): View =>
    problem(503, "unavailable", "Try again shortly."),
  NoOpenUnit: (_error: NoOpenUnit): View => internalErrorView,
} as const;

export type DefaultViewTag = keyof typeof defaultViews;

export type TagOf<E> = E extends { readonly _tag: infer Tag extends string } ? Tag : never;

type ErrorTagged<E, Tag> = Extract<E, { readonly _tag: Tag }>;

type WrongViewTags<E, Views> = {
  [Tag in TagOf<E> & keyof Views]: Views[Tag] extends (error: infer Takes, ...rest: never) => View
    ? [Takes] extends [never]
      ? never
      : [ErrorTagged<E, Tag>] extends [Takes]
        ? never
        : Tag
    : Tag;
}[TagOf<E> & keyof Views];

export type ViewsCheck<E, Views> = ([Exclude<TagOf<E>, DefaultViewTag | keyof Views>] extends [
  never,
]
  ? unknown
  : { readonly missingViews: Exclude<TagOf<E>, DefaultViewTag | keyof Views> }) &
  ([WrongViewTags<E, Views>] extends [never]
    ? unknown
    : { readonly wrongViews: WrongViewTags<E, Views> });

export const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined;

export const viewOf = (
  views: Readonly<Record<string, unknown>>,
  error: unknown,
  caller: Context.Context<never> | undefined,
): View => {
  const tag = tagOf(error);
  if (tag === undefined || !Object.hasOwn(views, tag)) return internalErrorView;
  const view = views[tag] as (error: unknown, caller: Context.Context<never> | undefined) => View;
  return view(error, caller);
};

export const safeViewOf = (
  views: Readonly<Record<string, unknown>>,
  error: unknown,
  caller: Context.Context<never> | undefined,
): Effect.Effect<View> =>
  Effect.try(() => viewOf(views, error, caller)).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("A view failed", cause).pipe(Effect.as(internalErrorView)),
    ),
  );
