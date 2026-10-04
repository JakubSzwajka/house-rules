import { Schema } from "effect";
import type { Approval } from "./approval.ts";
import { ApprovalDenied, Forbidden } from "./gate-errors.ts";
import type { Grant } from "./grant.ts";
import type { PermissionDeclaration } from "./permission.ts";

export type PlainSchema = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export const NoInput = Schema.Record(Schema.String, Schema.Never);

export type NoInput = typeof NoInput;

export type InputSchema = Schema.Struct<Record<string, PlainSchema>> | NoInput;

export type Annotations = Readonly<{
  readOnly: boolean;
  destructive: boolean;
}>;

export type Contract<
  Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  Permission extends PermissionDeclaration = PermissionDeclaration,
  NeedsApproval extends boolean = boolean,
> = Readonly<{
  _tag: "Contract";
  name: Name;
  description: string;
  input: Input;
  output: Output;
  failure: Failure;
  annotations: Annotations;
  permission: Permission;
  needsApproval: NeedsApproval;
}>;

export type AnyContract = Contract<
  string,
  InputSchema,
  PlainSchema,
  PlainSchema,
  PermissionDeclaration,
  boolean
>;

export type GrantRequirement<Permission extends PermissionDeclaration> = [Permission] extends [
  "public",
]
  ? never
  : Grant;

export type ApprovalRequirement<NeedsApproval extends boolean> = [NeedsApproval] extends [false]
  ? never
  : Approval;

export type GateRequirements<C extends AnyContract> =
  | GrantRequirement<C["permission"]>
  | ApprovalRequirement<C["needsApproval"]>;

type GateErrorSchemas<Permission extends PermissionDeclaration, NeedsApproval extends boolean> = [
  ...([Permission] extends ["public"] ? [] : [typeof Forbidden]),
  ...([NeedsApproval] extends [false] ? [] : [typeof ApprovalDenied]),
];

export type FailureSchemaOf<
  Failure extends PlainSchema,
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
> =
  GateErrorSchemas<Permission, NeedsApproval> extends []
    ? Failure
    : Schema.Union<readonly [Failure, ...GateErrorSchemas<Permission, NeedsApproval>]>;

export type FailureOf<C extends AnyContract> = FailureSchemaOf<
  C["failure"],
  C["permission"],
  C["needsApproval"]
>;

export type DefineContractOptions<
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
> = Readonly<{
  description: string;
  input: Input;
  output: Output;
  failure: Failure;
  permission: Permission;
  needsApproval?: NeedsApproval;
  annotations?: Partial<Annotations>;
}>;

const defaultAnnotations: Annotations = { readOnly: false, destructive: false };

export const defineContract = <
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  const Permission extends PermissionDeclaration,
  const NeedsApproval extends boolean = false,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure, Permission, NeedsApproval>,
): Contract<Name, Input, Output, Failure, Permission, NeedsApproval> => ({
  _tag: "Contract",
  name,
  description: options.description,
  input: options.input,
  output: options.output,
  failure: options.failure,
  annotations: { ...defaultAnnotations, ...options.annotations },
  permission: options.permission,
  needsApproval: (options.needsApproval ?? false) as NeedsApproval,
});

export const failureSchemaOf = <
  Failure extends PlainSchema,
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
>(
  contract: Readonly<{ failure: Failure; permission: Permission; needsApproval: NeedsApproval }>,
): FailureSchemaOf<Failure, Permission, NeedsApproval> => {
  const gates = [
    ...(contract.permission === "public" ? [] : [Forbidden]),
    ...(contract.needsApproval ? [ApprovalDenied] : []),
  ];
  const schema = gates.length === 0 ? contract.failure : Schema.Union([contract.failure, ...gates]);
  return schema as FailureSchemaOf<Failure, Permission, NeedsApproval>;
};
