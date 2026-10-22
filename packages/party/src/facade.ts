import type { MaySocket } from "@house-rules/application";
import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Option } from "effect";
import { memoryPersonStore } from "./adapters/memory/person.js";
import { postgresPersonStore } from "./adapters/postgres/person.js";
import { memoryPartyStore } from "./adapters/memory/party.js";
import { postgresPartyStore } from "./adapters/postgres/party.js";
import { PartyUnavailable } from "./organisation/organisation.js";
import { makeParty } from "./person/party.js";
import { makeAccess } from "./role/access.js";
import { PermissionCatalogue } from "@house-rules/application";
import type { PartyOptions } from "./role/role.js";
import { PartyStore, PersonStore } from "./storage.js";

type PartyService = ReturnType<typeof makeParty> & ReturnType<typeof makeAccess>;
export type PartyFailure = Effect.Error<ReturnType<PartyService[keyof PartyService]>>;

export class Party extends defineModule<Party, PartyService>()("party", {
  make: (options: PartyOptions) =>
    Effect.gen(function* () {
      const persons = yield* PersonStore;
      const store = yield* PartyStore;
      const catalogue = Option.getOrUndefined(yield* Effect.serviceOption(PermissionCatalogue));
      return {
        ...makeParty(persons),
        ...makeAccess(
          store,
          {
            find: (id) =>
              persons.find(id).pipe(Effect.mapError((cause) => new PartyUnavailable({ cause }))),
            list: (ids) =>
              persons.list(ids).pipe(Effect.mapError((cause) => new PartyUnavailable({ cause }))),
          },
          options,
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
