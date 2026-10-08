import { Schema } from "effect";
import type { Approval } from "./approval.ts";
import { ApprovalDenied, Forbidden } from "./gate-errors.ts";
import type { Grant } from "./grant.ts";
import type { PermissionDeclaration } from "./permission.ts";
import { type UnitOfWork, UnitOfWorkFailed } from "./unit-of-work.ts";

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
  Transactional extends boolean = boolean,
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
  transactional: Transactional;
}>;

export type AnyContract = Contract<
  string,
  InputSchema,
  PlainSchema,
  PlainSchema,
  PermissionDeclaration,
  boolean,
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

export type UnitOfWorkRequirement<Transactional extends boolean> = [Transactional] extends [false]
  ? never
  : UnitOfWork;

export type GateRequirements<C extends AnyContract> =
  | GrantRequirement<C["permission"]>
  | ApprovalRequirement<C["needsApproval"]>
  | UnitOfWorkRequirement<C["transactional"]>;

type GateErrorSchemas<
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
  Transactional extends boolean,
> = [
  ...([Permission] extends ["public"] ? [] : [typeof Forbidden]),
  ...([NeedsApproval] extends [false] ? [] : [typeof ApprovalDenied]),
  ...([Transactional] extends [false] ? [] : [typeof UnitOfWorkFailed]),
];

export type FailureSchemaOf<
  Failure extends PlainSchema,
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
  Transactional extends boolean = false,
> =
  GateErrorSchemas<Permission, NeedsApproval, Transactional> extends []
    ? Failure
    : Schema.Union<
        readonly [Failure, ...GateErrorSchemas<Permission, NeedsApproval, Transactional>]
      >;

export type FailureOf<C extends AnyContract> = FailureSchemaOf<
  C["failure"],
  C["permission"],
  C["needsApproval"],
  C["transactional"]
>;

export type DefineContractOptions<
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
  Transactional extends boolean = false,
> = Readonly<{
  description: string;
  input: Input;
  output: Output;
  failure: Failure;
  permission: Permission;
  needsApproval?: NeedsApproval;
  transactional?: Transactional;
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
  const Transactional extends boolean = false,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure, Permission, NeedsApproval, Transactional>,
): Contract<Name, Input, Output, Failure, Permission, NeedsApproval, Transactional> => ({
  _tag: "Contract",
  name,
  description: options.description,
  input: options.input,
  output: options.output,
  failure: options.failure,
  annotations: { ...defaultAnnotations, ...options.annotations },
  permission: options.permission,
  needsApproval: (options.needsApproval ?? false) as NeedsApproval,
  transactional: (options.transactional ?? false) as Transactional,
});

export const failureSchemaOf = <
  Failure extends PlainSchema,
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
  Transactional extends boolean,
>(
  contract: Readonly<{
    failure: Failure;
    permission: Permission;
    needsApproval: NeedsApproval;
    transactional: Transactional;
  }>,
): FailureSchemaOf<Failure, Permission, NeedsApproval, Transactional> => {
  const gates = [
    ...(contract.permission === "public" ? [] : [Forbidden]),
    ...(contract.needsApproval ? [ApprovalDenied] : []),
    ...(contract.transactional ? [UnitOfWorkFailed] : []),
  ];
  const schema = gates.length === 0 ? contract.failure : Schema.Union([contract.failure, ...gates]);
  return schema as FailureSchemaOf<Failure, Permission, NeedsApproval, Transactional>;
};
