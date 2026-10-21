import { Party } from "@house-rules/party";
import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect } from "effect";
export const seedRoleTesting = (
  id: string,
  roleKey = "member",
  organisationId: string | null = null,
) =>
  Effect.gen(function* () {
    const party = yield* Party;
    yield* UnitOfWork.atomic(
      Effect.gen(function* () {
        yield* party.createPerson({ id: ActorId.make(id), displayName: id });
        yield* party.assignRole(
          { kind: "system", reason: "test setup", startedBy: "test" },
          {
            personId: ActorId.make(id),
            roleKey,
            organisationId,
          },
        );
      }),
    );
  });
