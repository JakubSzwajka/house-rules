import type { ActorId, NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { Assignment } from "./assignment/assignment.js";
import type { Organisation, PartyUnavailable } from "./organisation/organisation.js";
import type { Relationship } from "./relationship/relationship.js";
import type { Role } from "./role/role.js";

export { PersonStore } from "./person/person-store.js";
type Read<A> = Effect.Effect<A, PartyUnavailable>;
type Write<A> = Effect.Effect<A, PartyUnavailable | NoOpenUnit>;

export class PartyStore extends Context.Service<
  PartyStore,
  {
    readonly organisation: (id: string) => Read<Organisation | undefined>;
    readonly insertOrganisation: (organisation: Organisation) => Write<boolean>;
    readonly relate: (relationship: Relationship) => Write<void>;
    readonly unrelate: (relationship: Relationship) => Write<void>;
    readonly isRelated: (relationship: Relationship) => Read<boolean>;
    readonly role: (key: string) => Read<Role | undefined>;
    readonly roles: (organisationIds?: readonly string[] | null) => Read<readonly Role[]>;
    readonly putRole: (role: Role) => Write<void>;
    readonly deleteRole: (key: string) => Write<void>;
    readonly assign: (assignment: Assignment) => Write<void>;
    readonly revoke: (assignment: Assignment) => Write<void>;
    readonly assignments: (
      personId: ActorId,
      organisationIds?: readonly string[] | null,
      builtInKeys?: readonly string[],
    ) => Read<readonly Assignment[]>;
  }
>()("@house-rules/party/PartyStore") {}
