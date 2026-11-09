import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ActedFor,
  type AuthProvider,
  agent,
  attributionOf,
  CurrentActor,
  clerk,
  devTokens,
  Forbidden,
  Notes,
  type Principal,
  PartyId,
  PersonId,
  partyOf,
  person,
  type RoleDefinitions,
  Roles,
  requirePermission,
  Session,
  SessionLive,
  sessionClient,
  system,
  targetKey,
} from "../index.ts";

export const RecipePermissions = {
  write: "recipes:write",
} as const;

export const RecipeId = Schema.NonEmptyString.pipe(Schema.brand("RecipeId"));
export type RecipeId = typeof RecipeId.Type;

export class RecipeAdded extends Domain.Event("RecipeAdded", {
  by: Schema.String,
  for: ActedFor,
  owner: PartyId,
  title: Schema.String,
}) {}

export class RecipeRenamed extends Domain.Event("RecipeRenamed", {
  by: Schema.String,
  for: ActedFor,
  title: Schema.String,
}) {}

export class RecipeExists extends Domain.Rejection("RecipeExists", {}, { httpApiStatus: 409 }) {}
export class NoSuchRecipe extends Domain.Rejection("NoSuchRecipe", {}, { httpApiStatus: 404 }) {}
export class NotRecipeOwner extends Domain.Rejection(
  "NotRecipeOwner",
  {},
  { httpApiStatus: 403 },
) {}

export class AddRecipe extends Domain.Command("AddRecipe", {
  target: RecipeId,
  middleware: [Session],
  input: { title: Schema.NonEmptyString },
  events: [RecipeAdded],
  rejects: [Forbidden, RecipeExists],
}) {}

export class RenameRecipe extends Domain.Command("RenameRecipe", {
  target: RecipeId,
  middleware: [Session],
  input: { title: Schema.NonEmptyString },
  events: [RecipeRenamed],
  rejects: [Forbidden, NoSuchRecipe, NotRecipeOwner],
}) {}

const Written = Schema.TaggedStruct("Written", { owner: PartyId, title: Schema.String });

export class Recipe extends Domain.Aggregate("Recipe", {
  id: RecipeId,
  state: Schema.Union([Schema.TaggedStruct("Unwritten", {}), Written]),
  initial: { _tag: "Unwritten" },
  commands: [AddRecipe, RenameRecipe],
  decide: {
    AddRecipe: Effect.fn(function* (recipe, cmd) {
      const actor = yield* requirePermission(RecipePermissions.write);
      if (recipe._tag !== "Unwritten") return yield* new RecipeExists();
      const owner = partyOf(actor);
      if (owner === null) return yield* new Forbidden({ permission: RecipePermissions.write });
      return [new RecipeAdded({ ...attributionOf(actor), owner, title: cmd.title })];
    }),
    RenameRecipe: Effect.fn(function* (recipe, cmd) {
      const actor = yield* requirePermission(RecipePermissions.write);
      if (recipe._tag !== "Written") return yield* new NoSuchRecipe();
      if (partyOf(actor) !== recipe.owner) return yield* new NotRecipeOwner();
      if (recipe.title === cmd.title) return [];
      return [new RecipeRenamed({ ...attributionOf(actor), title: cmd.title })];
    }),
  },
  evolve: {
    RecipeAdded: (_, e) => ({ _tag: "Written" as const, owner: e.owner, title: e.title }),
    RecipeRenamed: (s, e) => (s._tag === "Written" ? { ...s, title: e.title } : s),
  },
}) {}

export class Kitchen extends Domain.Model("Kitchen", {
  aggregates: [...Notes.aggregates, Recipe],
  views: [...Notes.views],
}) {}

export class KitchenApi extends Domain.Api("KitchenApi", {
  model: Kitchen,
  commands: ["AddRecipe", "RenameRecipe", "AddNote"],
  views: ["NotesOnTarget"],
  aggregates: [],
  streams: [],
}) {}

const cook = [RecipePermissions.write, Notes.NotesPermissions.write, Notes.NotesPermissions.read];

export const KitchenRoles = {
  cook,
  "org:member": cook,
  "org:admin": cook,
  guest: [],
} satisfies RoleDefinitions;

export const DEV_TOKENS: Readonly<Record<string, Principal>> = {
  "ann-token": { subject: "ann", orgId: null, roles: ["cook"] },
  "bob-token": { subject: "bob", orgId: null, roles: ["cook"] },
  "gus-token": { subject: "gus", orgId: null, roles: ["guest"] },
};

export const AuthFromEnv = Layer.unwrap(
  Effect.gen(function* () {
    const issuer = yield* Config.option(Config.NonEmptyString("CLERK_ISSUER"));
    return Option.isSome(issuer) ? clerk({ issuer: issuer.value }) : devTokens(DEV_TOKENS);
  }),
);

export const kitchenLive = <E, R>(auth: Layer.Layer<AuthProvider, E, R>) =>
  SessionLive.pipe(
    Layer.provide(Layer.mergeAll(auth, Roles.layer(KitchenRoles))),
    Layer.provideMerge(Kitchen.layer(Layer.empty)),
  );

const story = Story.make(Kitchen, {});
const ann = person("ann", { roles: ["cook"], permissions: KitchenRoles.cook });
const bob = person("bob", { roles: ["cook"], permissions: KitchenRoles.cook });
const soup = Recipe.ref(RecipeId.make("soup"));
const added = new RecipeAdded({ by: "ann", owner: PersonId.make("ann"), title: "Soup" });

describe("a new app: one own aggregate beside the Notes module", () => {
  it("is well defined", () => expect(Domain.verify(Kitchen)).toEqual([]));

  it.effect("a cook adds a recipe they then own", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(soup, new AddRecipe({ title: "Soup" })),
      Story.then(soup, added),
    ),
  );

  it.effect("an agent adds a recipe it owns itself, recorded for its person", () =>
    story(
      Story.provide(CurrentActor, agent("agent:claude", "ann", { permissions: KitchenRoles.cook })),
      Story.when(soup, new AddRecipe({ title: "Soup" })),
      Story.then(
        soup,
        new RecipeAdded({
          by: "agent:claude",
          for: PersonId.make("ann"),
          owner: PartyId.make("agent:claude"),
          title: "Soup",
        }),
      ),
      Story.when(soup, new RenameRecipe({ title: "Stew" })),
      Story.then(
        soup,
        new RecipeRenamed({ by: "agent:claude", for: PersonId.make("ann"), title: "Stew" }),
      ),
      Story.provide(CurrentActor, ann),
      Story.when(soup, new RenameRecipe({ title: "Broth" })),
      Story.rejected(new NotRecipeOwner()),
    ),
  );

  it.effect("only the owner renames it", () =>
    story(
      Story.given(soup, added),
      Story.provide(CurrentActor, bob),
      Story.when(soup, new RenameRecipe({ title: "Stew" })),
      Story.rejected(new NotRecipeOwner()),
    ),
  );

  it.effect("refuses a person without recipes:write", () =>
    story(
      Story.provide(CurrentActor, person("gus")),
      Story.when(soup, new AddRecipe({ title: "Soup" })),
      Story.rejected(new Forbidden({ permission: "recipes:write" })),
    ),
  );

  it.effect("refuses a system actor nobody granted recipes:write", () =>
    story(
      Story.provide(CurrentActor, system("importer")),
      Story.when(soup, new AddRecipe({ title: "Soup" })),
      Story.rejected(new Forbidden({ permission: "recipes:write" })),
    ),
  );

  it.live("serves the Api through Session, dev tokens and Roles", () =>
    Effect.gen(function* () {
      const as = (token: string) =>
        KitchenApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));
      const ann = yield* as("ann-token");
      const id = RecipeId.make("soup");
      yield* ann.AddRecipe(id, { title: "Soup" });
      const target = { kind: "recipe", id };
      const noted = yield* ann.AddNote(Notes.NoteId.make("n-1"), { target, body: "Less salt" });
      const notes = yield* ann.NotesOnTarget.get(targetKey(target), { atLeast: noted });
      expect(notes?.notes.map((note) => note.body)).toEqual(["Less salt"]);
      const bob = yield* as("bob-token");
      const notOwner = yield* bob.RenameRecipe(id, { title: "Stew" }).pipe(Effect.flip);
      expect(notOwner._tag).toBe("NotRecipeOwner");
      const gus = yield* as("gus-token");
      const forbidden = yield* gus
        .AddRecipe(RecipeId.make("pie"), { title: "Pie" })
        .pipe(Effect.flip);
      expect(forbidden._tag).toBe("Forbidden");
      const stranger = yield* as("nope");
      const anonymous = yield* stranger.AddRecipe(id, { title: "Soup" }).pipe(Effect.flip);
      expect(anonymous._tag).toBe("Unauthenticated");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        kitchenLive(AuthFromEnv).pipe(
          Layer.provide(platformForTests),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))),
        ),
      ),
    ),
  );

  it.live("with CLERK_ISSUER set, dev tokens no longer sign anyone in", () =>
    Effect.gen(function* () {
      const ann = yield* KitchenApi.clientInProcess.pipe(
        Effect.provide(sessionClient("ann-token")),
      );
      const refused = yield* ann
        .AddRecipe(RecipeId.make("soup"), { title: "Soup" })
        .pipe(Effect.flip);
      expect(refused._tag).toBe("Unauthenticated");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        kitchenLive(AuthFromEnv).pipe(
          Layer.provide(platformForTests),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromEnvRecord({ CLERK_ISSUER: "https://clerk.example.test" }),
            ),
          ),
        ),
      ),
    ),
  );
});
