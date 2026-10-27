import { Effect, Schema, SchemaAST, type SchemaIssue } from "effect";
import { errorKind, type InputSchema, type StructInput } from "@house-rules/domain/contract";
import type { AnyEntryPoint } from "../feature/feature.ts";

export const inputIssues = ["unexpected", "missing", "invalid", "repeated"] as const;

export type InputIssue = (typeof inputIssues)[number];

export class InputInvalid extends Schema.TaggedError<InputInvalid>()("InputInvalid", {
  kind: errorKind("invalid"),
  feature: Schema.String,
  field: Schema.String,
  issue: Schema.Literals(inputIssues),
  message: Schema.String,
}) {}

export class InputFault extends Schema.TaggedError<InputFault>()("InputFault", {
  field: Schema.String,
  issue: Schema.Literals(inputIssues),
  message: Schema.String,
}) {}

export const invalidFor =
  (feature: string) =>
  (fault: InputFault): InputInvalid =>
    new InputInvalid({
      feature,
      field: fault.field,
      issue: fault.issue,
      message: fault.message,
    });

export type InputSource = "json" | "strings";

type Leaf = Readonly<{ path: ReadonlyArray<PropertyKey>; tag: string }>;

const leafOf = (issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey> = []): Leaf => {
  switch (issue._tag) {
    case "Pointer":
      return leafOf(issue.issue, [...path, ...issue.path]);
    case "Filter":
    case "Encoding":
      return leafOf(issue.issue, path);
    case "Composite":
    case "AnyOf": {
      const [first] = issue.issues;
      return first === undefined ? { path, tag: issue._tag } : leafOf(first, path);
    }
    default:
      return { path, tag: issue._tag };
  }
};

const nameableField = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/u;

export const fieldName = (key: string): string => (nameableField.test(key) ? key : "input");

const faultFrom = (issue: SchemaIssue.Issue): InputFault => {
  const leaf = leafOf(issue);
  const field = fieldName(leaf.path.map(String).join("."));
  switch (leaf.tag) {
    case "UnexpectedKey":
      return new InputFault({
        field,
        issue: "unexpected",
        message: `${field} is not a field here.`,
      });
    case "MissingKey":
      return new InputFault({ field, issue: "missing", message: `${field} is required.` });
    default:
      return new InputFault({ field, issue: "invalid", message: `${field} is not valid.` });
  }
};

const codecOf = (schema: Schema.Top, source: InputSource) =>
  (source === "strings"
    ? Schema.toCodecStringTree(schema)
    : Schema.toCodecJson(schema)) as unknown as Schema.Codec<unknown, unknown>;

export const decodeInput = <E extends AnyEntryPoint>(
  feature: E,
  raw: unknown,
  source: InputSource,
): Effect.Effect<E["input"]["Type"], InputInvalid> =>
  Schema.decodeUnknownEffect(codecOf(feature.input, source))(raw, {
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError((error) => invalidFor(feature.name)(faultFrom(error.issue))),
    Effect.map((value) => value as E["input"]["Type"]),
  );

export const decodeValue = <E extends AnyEntryPoint>(
  feature: E,
  raw: unknown,
): Effect.Effect<E["input"]["Type"], InputInvalid> =>
  Schema.decodeUnknownEffect(Schema.toType(feature.input))(raw, {
    onExcessProperty: "error",
  }).pipe(Effect.mapError((error) => invalidFor(feature.name)(faultFrom(error.issue))));

const membersOf = (input: InputSchema): ReadonlyArray<StructInput> =>
  "members" in input ? input.members : "fields" in input ? [input as StructInput] : [];

const fieldOf = (input: InputSchema, key: string): Schema.Top | undefined => {
  const fields = membersOf(input).flatMap((member) =>
    Object.hasOwn(member.fields, key) ? [member.fields[key] as Schema.Top] : [],
  );
  const [first] = fields;
  return first !== undefined && fields.every((field) => field.ast === first.ast)
    ? first
    : undefined;
};

const isArrayOnStrings = (field: Schema.Top): boolean =>
  SchemaAST.toEncoded(Schema.toCodecStringTree(field).ast)._tag === "Arrays";

export const arrayKeysOf = (input: InputSchema): ReadonlySet<string> => {
  const members = membersOf(input);
  const keys = new Set(members.flatMap((member) => Object.keys(member.fields)));
  // A key is a list only when every member that has it reads a list from strings.
  return new Set(
    [...keys].filter((key) =>
      members.every(
        (member) =>
          !Object.hasOwn(member.fields, key) || isArrayOnStrings(member.fields[key] as Schema.Top),
      ),
    ),
  );
};

export const pathParamAsJson = (
  input: InputSchema,
  key: string,
  value: string,
): Effect.Effect<unknown, InputFault> => {
  const field = fieldOf(input, key);
  // A key the input lacks, or that members type differently, stays a string for the real decode to judge.
  if (field === undefined) return Effect.succeed(value);
  const one = Schema.Struct({ [key]: field });
  return Schema.decodeUnknownEffect(codecOf(one, "strings"))({ [key]: value }).pipe(
    Effect.flatMap(Schema.encodeUnknownEffect(codecOf(one, "json"))),
    Effect.map((encoded) => (encoded as Record<string, unknown>)[key]),
    Effect.mapError((error) => faultFrom(error.issue)),
  );
};
