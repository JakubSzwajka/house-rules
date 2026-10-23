import { errorKind } from "@house-rules/domain/contract";
import { Effect, Schema } from "effect";
import { validatePlan } from "./validate-plan.ts";
import { AppMapJson } from "../registry/app-map-json.ts";
import type { AppMapSnapshot } from "../registry/app-map-snapshot.ts";
import { renderMap } from "../registry/app-map.ts";
import { diffMaps } from "../registry/map-diff.ts";
import { renderMapDiff } from "../registry/map-diff-render.ts";
import { Plan } from "../registry/plan.ts";

export type PlanCommandRead = (path: string) => Promise<string>;
export interface PlanCommandResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly output?: Readonly<{ path: string; content: string }>;
}

export const planUsage = `Usage:
  plan view <plan.json> [-o out.html]
  plan validate <plan.json>
  plan diff <before.json> <after.json> [-o out.html] [--text]

Each diff side is a plan.json or an app map from renderMap(snapshot, "json").
Exit codes: 0 done, 1 invalid or unreadable input, 2 wrong arguments.
`;

class PlanInputInvalid extends Schema.TaggedError<PlanInputInvalid>()("PlanInputInvalid", {
  kind: errorKind("invalid"),
  reason: Schema.String,
  lines: Schema.Array(Schema.String),
}) {}

const invalid = (reason: string, lines: readonly string[] = []) =>
  new PlanInputInvalid({ reason, lines });

const decodePlan = Schema.decodeUnknownEffect(Plan);
const decodeMap = Schema.decodeUnknownEffect(AppMapJson);

const isMap = (value: unknown): boolean =>
  // A map JSON always has layers and permissions; a plan has neither.
  typeof value === "object" && value !== null && "layers" in value && "permissions" in value;

const load = (read: PlanCommandRead, path: string, allowMap: boolean) =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => read(path),
      catch: () => invalid(`${path}: cannot read the file`),
    });
    const json: unknown = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (error) =>
        invalid(`${path}: not valid JSON`, [error instanceof Error ? error.message : ""]),
    });
    if (allowMap && isMap(json))
      return (yield* decodeMap(json, { errors: "all" }).pipe(
        Effect.mapError((error) =>
          invalid(
            `${path}: not a valid app map. It was read as an app map because it has both "layers" and "permissions". Regenerate a snapshot with the app's map script; a plan must not have those keys`,
            error.message.split("\n"),
          ),
        ),
      )) as AppMapSnapshot;
    const plan = yield* decodePlan(json, { errors: "all" }).pipe(
      Effect.mapError((error) => invalid(`${path}: not a valid plan`, error.message.split("\n"))),
    );
    return yield* validatePlan(plan).pipe(
      Effect.mapError((error) =>
        invalid(
          `${path}: plan has ${error.issues.length} issue${error.issues.length === 1 ? "" : "s"}`,
          error.issues.map((issue) => `${issue.path}: ${issue.reason}`),
        ),
      ),
    );
  });

type Parsed = Readonly<{ files: string[]; output?: string; text: boolean }> | string;

const parse = (args: readonly string[]): Parsed => {
  const files: string[] = [];
  let output: string | undefined;
  let text = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-o" || arg === "--out") {
      output = args[index + 1];
      index++;
      if (output === undefined || output.startsWith("-")) return `${arg} needs a file path`;
    } else if (arg === "--text") text = true;
    else if (arg.startsWith("-")) return `Unknown option ${arg}`;
    else files.push(arg);
  }
  return { files, text, ...(output === undefined ? {} : { output }) };
};

const emit = (output: string | undefined, content: string): PlanCommandResult =>
  output === undefined
    ? { exitCode: 0, stdout: content, stderr: "" }
    : { exitCode: 0, stdout: "", stderr: `Wrote ${output}\n`, output: { path: output, content } };

export const planCommand = (
  args: readonly string[],
  read: PlanCommandRead,
): Effect.Effect<PlanCommandResult> => {
  const [command, ...rest] = args.filter((arg) => arg !== "--");
  const parsed = parse(rest);
  const usage = (reason: string): Effect.Effect<PlanCommandResult> =>
    Effect.succeed({ exitCode: 2, stdout: "", stderr: `${reason}\n\n${planUsage}` });
  if (command === "help" || command === "--help" || command === "-h")
    return Effect.succeed({ exitCode: 0, stdout: planUsage, stderr: "" });
  if (typeof parsed === "string") return usage(parsed);
  if (command === "validate" && (parsed.output !== undefined || parsed.text))
    return usage("validate accepts only a plan file");
  const run =
    command === "validate" && parsed.files.length === 1
      ? load(read, parsed.files[0] ?? "", false).pipe(Effect.map(() => emit(undefined, "valid\n")))
      : command === "view" && parsed.files.length === 1 && !parsed.text
        ? load(read, parsed.files[0] ?? "", false).pipe(
            Effect.map((snapshot) => emit(parsed.output, renderMap(snapshot, "html"))),
          )
        : command === "diff" && parsed.files.length === 2
          ? Effect.all([
              load(read, parsed.files[0] ?? "", true),
              load(read, parsed.files[1] ?? "", true),
            ]).pipe(
              Effect.map(([before, after]) =>
                emit(
                  parsed.output,
                  renderMapDiff(diffMaps(before, after), parsed.text ? "text" : "html"),
                ),
              ),
            )
          : undefined;
  if (run === undefined) return usage("Wrong arguments");
  return run.pipe(
    Effect.catchTag("PlanInputInvalid", (error) =>
      Effect.succeed<PlanCommandResult>({
        exitCode: 1,
        stdout: "",
        stderr: `${[error.reason, ...error.lines.map((line) => `  ${line}`)].join("\n")}\n`,
      }),
    ),
  );
};

export const runPlanCommand = (
  args: readonly string[],
  read: PlanCommandRead,
): Promise<PlanCommandResult> => Effect.runPromise(planCommand(args, read));
