import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { slugSettler } from "./permissions.ts";
import { Project } from "./project.aggregate.ts";
import { ReleaseSlug } from "./release-slug.command.ts";
import { SlugClaim } from "./slug-claim.aggregate.ts";
import { ProjectSlugChanged } from "./switch-project-slug.command.ts";

export class SlugRelease extends Domain.Policy("SlugRelease", {
  from: Project,
  on: [ProjectSlugChanged],
}) {}

export const SlugReleaseLive = SlugRelease.toLayer(
  Effect.gen(function* () {
    const claims = yield* SlugClaim;
    return Effect.fn(
      function* ({ source, event }) {
        yield* claims.send(event.from, new ReleaseSlug({ project: source.id }));
      },
      Effect.orDie,
      Effect.provideService(CurrentActor, slugSettler),
    );
  }),
);
