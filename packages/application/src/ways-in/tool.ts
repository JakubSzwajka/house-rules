import { Context, Schema } from "effect";
import { Tool } from "effect/ai";
import { toolParameters } from "../contract/tool-parameters.ts";
import type { AnyEntry } from "../entry/entry.ts";

export const makeTool = (
  entry: AnyEntry,
  options: Readonly<{ title: string; idempotent: boolean; openWorld: boolean }>,
) =>
  Tool.make(entry.node.name, {
    description: entry.node.description,
    parameters: toolParameters(entry.node.input),
    success: Schema.toCodecJson(entry.node.output),
    failure: Schema.Unknown,
  })
    .annotate(Tool.Title, options.title)
    .annotateMerge(
      Context.make(Tool.Strict, true).pipe(
        Context.add(Tool.Readonly, entry.readOnly),
        Context.add(Tool.Destructive, entry.destructive),
        Context.add(Tool.Idempotent, options.idempotent),
        Context.add(Tool.OpenWorld, options.openWorld),
      ),
    );
