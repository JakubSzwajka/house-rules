import type { Approval } from "../gates/approval.ts";
import type { FailureOfCapability, Mountable, ServicesOf } from "./invoke.ts";
import type { ViewsCheck } from "./views.ts";

export type ServicesCheck<Needs, Provided> = [Exclude<Needs, Provided>] extends [never]
  ? unknown
  : { readonly missingServices: Exclude<Needs, Provided> };

export type MountCheck<Cap extends Mountable, A, C, Views, E = never> = ViewsCheck<
  FailureOfCapability<Cap> | E,
  Views
> &
  ServicesCheck<ServicesOf<Cap>, A | C | Approval>;
