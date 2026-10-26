import { Context, Schema } from "effect";
import { Tool } from "effect/ai";
import { toolParameters } from "../contract/tool-parameters.ts";
import type { AnyEntryPoint } from "../feature/feature.ts";

export const makeTool = (
  feature: AnyEntryPoint,
  options: Readonly<{ title: string; idempotent: boolean; openWorld: boolean }>,
) =>
  Tool.make(feature.name, {
    description: feature.description,
    parameters: toolParameters(feature.input),
    success: Schema.toCodecJson(feature.output),
    failure: Schema.Unknown,
  })
    .annotate(Tool.Title, options.title)
    .annotateMerge(
      Context.make(Tool.Strict, true).pipe(
        Context.add(Tool.Readonly, feature.readOnly),
        Context.add(Tool.Destructive, feature.destructive),
        Context.add(Tool.Idempotent, options.idempotent),
        Context.add(Tool.OpenWorld, options.openWorld),
      ),
    );
