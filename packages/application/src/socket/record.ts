import type { Layer } from "effect";
import type { CallWatch } from "../call/call-watch.ts";

export interface RecordSocket<E = never, R = never> {
  readonly layer: Layer.Layer<CallWatch, E, R>;
}
