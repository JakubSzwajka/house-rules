import { Context } from "effect";
import type { Actor } from "./actor.ts";

export class Viewer extends Context.Service<Viewer, Actor>()("@house-rules/capability/Viewer") {}
