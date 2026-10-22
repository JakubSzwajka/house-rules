import { Context } from "effect";
import type { MaySocket } from "./may.ts";
import type { MayUnavailable } from "./may-unavailable.ts";

export class ResolvedMay extends Context.Service<ResolvedMay, MaySocket<MayUnavailable>>()(
  "@house-rules/application/ResolvedMay",
) {}
