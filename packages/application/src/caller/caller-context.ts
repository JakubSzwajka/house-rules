import { type Caller, PerRequest } from "@house-rules/domain";
import { Context } from "effect";

export class CallerContext extends Context.Service<CallerContext, Caller>()(
  "@house-rules/application/CallerContext",
) {
  declare readonly [PerRequest]: typeof PerRequest;
}
