import { Schema, SchemaAST, SchemaIssue, SchemaTransformation } from "effect";
import type { InputSchema, StructInput, UnionInput } from "./contract.ts";

type KeysOf<Member> = Member extends Schema.Struct<infer Fields> ? keyof Fields & string : never;

type FieldAt<Member, Key> =
  Member extends Schema.Struct<infer Fields>
    ? Key extends keyof Fields
      ? Fields[Key]
      : never
    : never;

type LacksKey<Member, Key> =
  Member extends Schema.Struct<infer Fields> ? (Key extends keyof Fields ? never : Member) : never;

type IsOptional<Member, Key> = [LacksKey<Member, Key>] extends [never]
  ? [Extract<FieldAt<Member, Key>["~encoded.optionality"], "optional">] extends [never]
    ? false
    : true
  : true;

type MergedField<Field extends Schema.Top, Optional extends boolean> = Optional extends true
  ? Schema.optionalKey<Schema.Codec<Field["Encoded"]>>
  : Schema.Codec<Field["Encoded"]>;

export type MergedParameters<Members extends ReadonlyArray<StructInput>> = Schema.Struct<{
  readonly [Key in KeysOf<Members[number]>]: MergedField<
    FieldAt<Members[number], Key>,
    IsOptional<Members[number], Key>
  >;
}>;

export type ToolParameters<Input extends InputSchema> =
  Input extends Schema.Union<infer Members extends ReadonlyArray<StructInput>>
    ? Schema.decodeTo<Input, MergedParameters<Members>>
    : Input;

const isUnionInput = (input: InputSchema): input is UnionInput => "members" in input;

const isOptionalKey = (field: Schema.Top): field is Schema.optionalKey<Schema.Top> =>
  SchemaAST.isOptional(field.ast) && "schema" in field;

const encodedSide = (field: Schema.Top): Schema.Top =>
  Schema.toEncoded(isOptionalKey(field) ? field.schema : field);

const hasDecodeLogic = (ast: SchemaAST.AST): boolean =>
  ast.checks !== undefined ||
  ast.encoding !== undefined ||
  ("encodingChecks" in ast && ast.encodingChecks !== undefined);

const passesMissingGetters = new Set(["Passthrough", "Transform", "TransformEffect"]);

const passesMissing = (ast: SchemaAST.AST): boolean =>
  // Effect 4.0.3 internal/schema/interpreter.ts passes a missing key through these getters without running checks.
  ast._tag !== "Suspend" &&
  (ast.encoding ?? []).every(
    (link) =>
      link.transformation._tag === "Transformation" &&
      passesMissingGetters.has(link.transformation.decode._tag) &&
      passesMissing(link.to),
  );

const takesMissingKey = (member: StructInput, field: Schema.Top): boolean =>
  !hasDecodeLogic(member.ast) &&
  passesMissing(field.ast) &&
  SchemaAST.isOptional(SchemaAST.toEncoded(field.ast)) &&
  SchemaAST.isOptional(SchemaAST.toType(field.ast));

const fieldNames = (member: StructInput): ReadonlyArray<string> =>
  // Effect's Struct reads fields with Reflect.ownKeys (SchemaAST.struct), so non-enumerable ones count.
  Reflect.ownKeys(member.fields).filter((key) => typeof key === "string");

const ownField = (member: StructInput, key: string): Schema.Top | undefined =>
  Object.hasOwn(member.fields, key) ? member.fields[key] : undefined;

const advertisedField = (input: UnionInput, key: string): Schema.Top => {
  const owners = input.members.flatMap((member) => {
    const field = ownField(member, key);
    return field === undefined ? [] : [{ member, field }];
  });
  const fields = owners.map(({ field }) => field);
  // Errs strict: a key every member declares is optional only when one member visibly takes it missing.
  const required =
    owners.length === input.members.length &&
    (hasDecodeLogic(input.ast) ||
      !owners.some(({ member, field }) => takesMissingKey(member, field)));
  const byAst = new Map(fields.map(encodedSide).map((schema) => [schema.ast, schema]));
  const variants = [...byAst.values()];
  const [only] = variants;
  const schema = variants.length === 1 && only !== undefined ? only : Schema.Union(variants);
  return required ? schema : Schema.optionalKey(schema);
};

const isPlainRecord = (input: unknown): input is Readonly<Record<PropertyKey, unknown>> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

const gate = (keys: ReadonlySet<string>, advertised: Schema.Top) =>
  // Schema.Any keeps its checks through toCodecJson (effect internal/schema/toCodec.ts:119); Schema.Unknown would not.
  Schema.Any.check(
    Schema.makeFilter<unknown>(
      (input, ast, options) => {
        if (!isPlainRecord(input)) return false;
        const unexpected = Reflect.ownKeys(input).filter(
          (key) => typeof key !== "string" || !keys.has(key),
        );
        return unexpected.map((key) => ({
          path: [key],
          issue: new SchemaIssue.UnexpectedKey(ast, input[key], options),
        }));
      },
      {
        expected: "an object with only the keys of the input's members",
        // The compiler hands the compiled advertisement back as schemas[0], as in Schema.isPropertyNames.
        representation: {
          id: "@house-rules/application/union-tool-input",
          payload: null,
          schemas: [Schema.toEncoded(Schema.toCodecJson(advertised)).ast],
        },
        toJsonSchema: ({ schemas }) => ({
          ...schemas[0],
          additionalProperties: false,
        }),
      },
    ),
  );

export const toolParameters = <Input extends InputSchema>(input: Input): ToolParameters<Input> => {
  if (!isUnionInput(input)) return input as ToolParameters<Input>;
  // The gate checks only the outer shape, so the real Union alone decides what decodes and how.
  const keys = [...new Set(input.members.flatMap(fieldNames))];
  const advertised = Schema.Struct(
    Object.fromEntries(keys.map((key) => [key, advertisedField(input, key)])),
  );
  return gate(new Set(keys), advertised).pipe(
    Schema.decodeTo(input, SchemaTransformation.passthroughSupertype()),
  ) as unknown as ToolParameters<Input>;
};
