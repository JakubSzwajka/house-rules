import { Effect, Schema, type SchemaIssue } from "effect";
import type { AnyContract, InputSchema, StructInput } from "../contract/contract.ts";

export class InputInvalid extends Schema.TaggedError<InputInvalid>()("InputInvalid", {
  field: Schema.String,
  message: Schema.String,
}) {}

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

const invalidFrom = (issue: SchemaIssue.Issue): InputInvalid => {
  const leaf = leafOf(issue);
  const field = fieldName(leaf.path.map(String).join("."));
  switch (leaf.tag) {
    case "UnexpectedKey":
      return new InputInvalid({ field, message: `${field} is not a field here.` });
    case "MissingKey":
      return new InputInvalid({ field, message: `${field} is required.` });
    default:
      return new InputInvalid({ field, message: `${field} is not valid.` });
  }
};

const codecOf = (schema: Schema.Top, source: InputSource) =>
  (source === "strings"
    ? Schema.toCodecStringTree(schema)
    : Schema.toCodecJson(schema)) as unknown as Schema.Codec<unknown, unknown>;

export const decodeInput = <Contract extends AnyContract>(
  contract: Contract,
  raw: unknown,
  source: InputSource,
): Effect.Effect<Contract["input"]["Type"], InputInvalid> =>
  Schema.decodeUnknownEffect(codecOf(contract.input, source))(raw, {
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError((error) => invalidFrom(error.issue)),
    Effect.map((value) => value as Contract["input"]["Type"]),
  );

export const encodeInput = (contract: AnyContract, value: unknown): Effect.Effect<unknown> =>
  Schema.encodeUnknownEffect(codecOf(contract.input, "json"))(value).pipe(Effect.orDie);

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

export const pathParamAsJson = (
  input: InputSchema,
  key: string,
  value: string,
): Effect.Effect<unknown, InputInvalid> => {
  const field = fieldOf(input, key);
  // A key the input lacks, or that members type differently, stays a string for the real decode to judge.
  if (field === undefined) return Effect.succeed(value);
  const one = Schema.Struct({ [key]: field });
  return Schema.decodeUnknownEffect(codecOf(one, "strings"))({ [key]: value }).pipe(
    Effect.flatMap(Schema.encodeUnknownEffect(codecOf(one, "json"))),
    Effect.map((encoded) => (encoded as Record<string, unknown>)[key]),
    Effect.mapError((error) => invalidFrom(error.issue)),
  );
};
