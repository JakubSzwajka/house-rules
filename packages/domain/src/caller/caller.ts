import type { Actor } from "../actor/actor.ts";

export type PersonCaller = Readonly<{ kind: "person"; actor: Actor; via: string }>;
export type SystemCaller = Readonly<{ kind: "system"; reason: string; startedBy: string }>;
export type Caller = PersonCaller | SystemCaller;
