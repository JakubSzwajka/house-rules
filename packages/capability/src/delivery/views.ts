import { type Context, Effect } from "effect";
import type { ApprovalDenied, Forbidden } from "../gates/gate-errors.ts";
import type { NoOpenUnit, UnitOfWorkFailed } from "../unit-of-work/unit-of-work.ts";
import type { Refused } from "./caller.ts";
import type { CompositionClosed } from "./composition-closed.ts";
import type { InputInvalid } from "./input.ts";

export type View = Readonly<{
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
  code?: string;
}>;

export type CallerContext<C> = Context.Context<C> | undefined;

export type ViewFn<C = never> = (error: never, caller: CallerContext<C>) => View;

export type ViewTable<C = never> = Readonly<Record<string, ViewFn<C>>>;

export type DefectStatusReserved = "status 500 is reserved for defects; a view may not answer it";

export type ViewStatus<S extends number> = [number] extends [S]
  ? S
  : 500 extends S
    ? DefectStatusReserved
    : S;

const problemBody = (
  status: number,
  code: string,
  message: string,
  extra: Readonly<Record<string, unknown>>,
): View => ({ status, body: { error: { code, message, ...extra } } });

export const problem = <const S extends number>(
  status: ViewStatus<S>,
  code: string,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
): View => problemBody(status as number, code, message, extra);

export const internalErrorView: View = problemBody(
  500,
  "internal_error",
  "Something went wrong on the server.",
  {},
);

export type StaticStatus = Readonly<{ status: number }>;

const atStatus = <Fn extends (error: never) => View>(status: number, view: Fn): Fn & StaticStatus =>
  Object.assign(view, { status });

export type ProblemViewOptions = Readonly<{ exposeCode?: boolean }>;

export const problemView = <E, const S extends number = number>(
  viewStatus: ViewStatus<S>,
  code: string,
  message: (error: E) => string,
  options: ProblemViewOptions = {},
): ((error: E) => View) & StaticStatus => {
  const status = viewStatus as number;
  if (options.exposeCode !== true) {
    return atStatus(status, (error: E) => problemBody(status, code, message(error), {}));
  }
  const view = atStatus(status, (error: E) => ({
    ...problemBody(status, code, message(error), {}),
    code,
  }));
  return Object.assign(view, { code });
};

export const staticStatusOf = (view: unknown): number | undefined =>
  typeof view === "function" && "status" in view && typeof view.status === "number"
    ? view.status
    : undefined;

export const staticCodeOf = (view: unknown): string | undefined =>
  typeof view === "function" && "code" in view && typeof view.code === "string"
    ? view.code
    : undefined;

export const defaultViews = {
  Refused: (error: Refused): View => ({
    ...problemBody(error.status, error.code, error.message, {}),
    ...(error.challenge === undefined ? {} : { headers: { "www-authenticate": error.challenge } }),
  }),
  InputInvalid: atStatus(
    400,
    (error: InputInvalid): View =>
      problemBody(400, "invalid_input", error.message, { field: error.field }),
  ),
  Forbidden: problemView(
    403,
    "forbidden",
    (error: Forbidden) => `You may not use ${error.capabilityName}.`,
  ),
  ApprovalDenied: problemView(
    403,
    "approval_denied",
    (error: ApprovalDenied) => `${error.capabilityName} was not approved: ${error.reason}.`,
  ),
  UnitOfWorkFailed: problemView(
    503,
    "unavailable",
    (_error: UnitOfWorkFailed) => "Try again shortly.",
  ),
  NoOpenUnit: atStatus(500, (_error: NoOpenUnit): View => internalErrorView),
  CompositionClosed: problemView(
    503,
    "unavailable",
    (_error: CompositionClosed) => "The app is shutting down.",
  ),
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

const withoutDefectStatus = (view: View, error: unknown): Effect.Effect<View> =>
  // A status held in a variable slips past ViewStatus, so a 500 view's body could leak a reason.
  view.status === internalErrorView.status && view !== internalErrorView
    ? Effect.logError("A view answered 500, which only a defect may; sent internal_error", {
        failure: tagOf(error),
        body: view.body,
      }).pipe(Effect.as(internalErrorView))
    : Effect.succeed(view);

export const safeViewOf = (
  views: Readonly<Record<string, unknown>>,
  error: unknown,
  caller: Context.Context<never> | undefined,
): Effect.Effect<View> =>
  Effect.try(() => viewOf(views, error, caller)).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("A view failed", cause).pipe(Effect.as(internalErrorView)),
    ),
    Effect.flatMap((view) => withoutDefectStatus(view, error)),
  );
