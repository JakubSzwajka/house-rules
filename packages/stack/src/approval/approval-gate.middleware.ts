import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";

export class ApprovalRequired extends Schema.TaggedError<ApprovalRequired>()(
  "ApprovalRequired",
  { command: Schema.String },
  { httpApiStatus: 403 },
) {}

export class ApprovalGate extends RpcMiddleware.Service<ApprovalGate>()("HouseRules/ApprovalGate", {
  error: ApprovalRequired,
}) {}
