import * as Domain from "@alchemy.run/domain";
import { Workflow } from "./workflow.ts";

export class CurrentWorkflow extends Domain.RequestContext<CurrentWorkflow>()(
  "HouseRules/WorkItems/CurrentWorkflow",
  Workflow,
) {}
