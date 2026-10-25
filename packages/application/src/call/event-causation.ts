import { Context } from "effect";

export const EventCausation = Context.Reference<string | null | undefined>(
  "@house-rules/application/EventCausation",
  { defaultValue: () => undefined },
);
