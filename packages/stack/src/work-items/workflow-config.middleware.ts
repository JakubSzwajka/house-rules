import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";
import { CurrentWorkflow } from "./current-workflow.context.ts";
import { Workflow } from "./workflow.ts";

export class WorkflowConfig extends RpcMiddleware.Service<
  WorkflowConfig,
  { provides: CurrentWorkflow }
>()("HouseRules/WorkItems/WorkflowConfig") {}

export const workflowConfig = (workflow: Workflow) =>
  Layer.effect(
    WorkflowConfig,
    Effect.map(
      Schema.decodeEffect(Workflow)(workflow),
      (valid) => (effect) => Effect.provideService(effect, CurrentWorkflow, valid),
    ),
  );
