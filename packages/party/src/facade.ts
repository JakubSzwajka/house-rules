import type { MaySocket } from "@house-rules/application";
import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Option, Schema } from "effect";
import { memoryPersonStore } from "./adapters/memory/person.js";
import { postgresPersonStore } from "./adapters/postgres/person.js";
import { memoryPartyStore } from "./adapters/memory/party.js";
import { postgresPartyStore } from "./adapters/postgres/party.js";
import { PartyInputInvalid, PartyUnavailable } from "./organisation/organisation.js";
import { makeParty } from "./person/party.js";
import { makePrincipals } from "./person/principals.js";
import { makeAccess } from "./role/access.js";
import { PermissionCatalogue } from "@house-rules/application";
import type { PartyOptions } from "./role/role.js";
import { PartyStore, PersonStore } from "./storage.js";

type PartyService = ReturnType<typeof makeParty> &
  ReturnType<typeof makeAccess> &
  ReturnType<typeof makePrincipals>;
export type PartyFailure = Effect.Error<ReturnType<PartyService[keyof PartyService]>>;

export class Party extends defineModule<Party, PartyService>()("party", {
  make: (options: PartyOptions) =>
    Effect.gen(function* () {
      const holdersLimit = yield* Schema.decodeEffect(
        Schema.Int.check(
          Schema.isGreaterThanOrEqualTo(1),
          Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER - 1),
        ),
      )(options.holdersLimit ?? 1000).pipe(
        Effect.mapError(() => new PartyInputInvalid({ message: "Invalid holders limit." })),
      );
      const persons = yield* PersonStore;
      const store = yield* PartyStore;
      const catalogue = Option.getOrUndefined(yield* Effect.serviceOption(PermissionCatalogue));
      return {
        ...makeParty(persons),
        ...makePrincipals(persons, options),
        ...makeAccess(
          store,
          {
            find: (id) =>
              persons.find(id).pipe(Effect.mapError((cause) => new PartyUnavailable({ cause }))),
            principal: (id) =>
              persons
                .principal(id)
                .pipe(Effect.mapError((cause) => new PartyUnavailable({ cause }))),
            list: (ids) =>
              persons.list(ids).pipe(Effect.mapError((cause) => new PartyUnavailable({ cause }))),
          },
          { ...options, holdersLimit },
          catalogue,
        ),
      };
    }),
}) {
  static readonly layerMemory = (options: PartyOptions) =>
    this.layer(options).pipe(Layer.provide(Layer.merge(memoryPersonStore(), memoryPartyStore())));
  static readonly layerPostgres = (options: PartyOptions) =>
    this.layer(options).pipe(Layer.provide(Layer.merge(postgresPersonStore, postgresPartyStore)));
  static readonly may = (
    _options?: Record<never, never>,
  ): Effect.Effect<
    MaySocket<import("./organisation/organisation.js").PartyUnavailable>,
    never,
    Party
  > => Effect.map(Party, (party) => ({ permissionsOf: party.permissionsOf }));
}
