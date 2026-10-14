import type { UnitOfWork } from "@house-rules/domain";
import type { Approval } from "../gates/approval.ts";
import type { Grant } from "../gates/grant.ts";
import type { PermissionDeclaration } from "../gates/permission.ts";
import type { AnyContract } from "../contract/contract.ts";

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
