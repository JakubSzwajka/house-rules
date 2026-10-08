import { Context, type Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import {
  type Contract,
  type FailureSchemaOf,
  failureSchemaOf,
  type InputSchema,
  type PlainSchema,
} from "./contract.ts";
import type { PermissionDeclaration } from "./permission.ts";

export type ToToolOptions = Readonly<{
  title: string;
  idempotent: boolean;
  openWorld: boolean;
  success?: Schema.Top | undefined;
  failure?: Schema.Top | undefined;
}>;

export type ToolSchema<
  Options extends ToToolOptions,
  Key extends "success" | "failure",
  Fallback extends Schema.Top,
> = Options extends unknown
  ? Key extends keyof Options
    ?
        | Exclude<Options[Key], undefined>
        | (undefined extends Options[Key]
            ? Fallback
            : {} extends Pick<Options, Key>
              ? Fallback
              : never)
    : Fallback
  : never;

export type ContractTool<
  Name extends string,
  Input extends InputSchema,
  Success extends Schema.Top,
  Failure extends Schema.Top,
> = Tool.Tool<
  Name,
  {
    readonly parameters: Input;
    readonly success: Success;
    readonly failure: Failure;
    readonly failureMode: "error";
  }
>;

export const toTool = <
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  ContractFailure extends PlainSchema,
  Permission extends PermissionDeclaration,
  NeedsApproval extends boolean,
  Transactional extends boolean,
  Options extends ToToolOptions,
>(
  contract: Contract<
    Name,
    Input,
    Output,
    ContractFailure,
    Permission,
    NeedsApproval,
    Transactional
  >,
  options: Options,
): ContractTool<
  Name,
  Input,
  ToolSchema<Options, "success", Output>,
  ToolSchema<
    Options,
    "failure",
    FailureSchemaOf<ContractFailure, Permission, NeedsApproval, Transactional>
  >
> => {
  const success = (options.success ?? contract.output) as ToolSchema<Options, "success", Output>;
  const failure = (options.failure ?? failureSchemaOf(contract)) as ToolSchema<
    Options,
    "failure",
    FailureSchemaOf<ContractFailure, Permission, NeedsApproval, Transactional>
  >;
  return Tool.make(contract.name, {
    description: contract.description,
    parameters: contract.input,
    success,
    failure,
  })
    .annotate(Tool.Title, options.title)
    .annotateMerge(
      Context.make(Tool.Readonly, contract.annotations.readOnly).pipe(
        Context.add(Tool.Destructive, contract.annotations.destructive),
        Context.add(Tool.Idempotent, options.idempotent),
        Context.add(Tool.OpenWorld, options.openWorld),
      ),
    );
};
