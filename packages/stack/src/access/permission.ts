import type { Actor } from "../actor/actor.ts";

export type Permission = `${string}:${string}`;

export const can = (actor: Actor, permission: Permission): boolean =>
  actor.permissions.includes(permission);
