# Projects

Project records with configurable statuses and slugs unique across projects.

## Compose

```ts
class App extends Domain.Model("App", {
  aggregates: [...Projects.aggregates],
  views: [...Projects.views],
  policies: [...Projects.policies],
}) {}

const Host = App.layer(Projects.handlers);
const Middleware = Layer.mergeAll(SessionLive, Projects.projectsConfig(Projects.defaultStatuses));
```

`projectsConfig(statuses)` serves the `ProjectsConfig` middleware, which gives `ProjectSettings` to the commands that read statuses. It fails the Layer build when the default status is missing from the list, or when a status repeats. `defaultStatuses` is active and archived, defaulting to active. Statuses are exact, case-sensitive strings.

## Unique slugs

A `SlugClaim` aggregate keyed by the slug holds the one project that owns it. Two claims of one slug race on one instance, and exactly one wins. The slug is claimed before the project exists:

1. A client sends `CreateProject { project, name, status?, description? }` to `SlugClaim(slug)`. A slug held by another project is refused at once with `SlugTaken { project }`. Otherwise the claim records `SlugReserved`.
2. `ProjectOpening` reacts and sends `OpenProject` to `Project(project)`, which records `ProjectCreated`. If that project id already exists, it is refused with `ProjectExists`, and the policy sends `ReleaseSlug` back to the claim.

A slug change follows the same order. `ChangeProjectSlug { project }` claims the new slug (`SlugClaimed`). `ProjectOpening` then sends `SwitchProjectSlug`, which records `ProjectSlugChanged { from, to }`, and `SlugRelease` frees the old claim. A missing project gives the new claim back. `ReleaseSlug` frees a claim only for the project that holds it. A repeated claim by the same project records nothing.

Slugs are the claim's id: 1 to 64 characters, starting with a lowercase letter or digit, then lowercase letters, digits or hyphens. Clients send them already trimmed and lowercased; anything else fails the id schema. Slugs stay unique whatever the status.

## Commands and facts

| Command | Target | Records | Rejects |
| --- | --- | --- | --- |
| CreateProject | SlugClaim | SlugReserved | SlugTaken, UnknownStatus |
| ChangeProjectSlug | SlugClaim | SlugClaimed | SlugTaken |
| EditProject `{ name?, description? }` | Project | ProjectEdited | ProjectNotFound |
| ChangeProjectStatus `{ status }` | Project | ProjectStatusChanged | ProjectNotFound, UnknownStatus |
| OpenProject, SwitchProjectSlug | Project | ProjectCreated, ProjectSlugChanged | ProjectExists, ProjectNotFound |
| ReleaseSlug | SlugClaim | SlugReleased | none |

Every command also rejects `Forbidden`. Names are trimmed and 1 to 200 characters. Descriptions are plain text, empty by default. An unchanged edit and a status the project already has record nothing. Archiving is `ChangeProjectStatus` to the app's archived status, never a delete. Each change records `by`, the requester; the system commands carry the requester's `by` from the claim.

## Access

People need `projects:write` for every client command, and `projects:read` to read a `Project` or the `ProjectDirectory` view. `OpenProject`, `SwitchProjectSlug` and `ReleaseSlug` need `projects:settle-slug`, which only the policies' system actor `slugSettler` holds. Projects store no owner; an app that limits who may change a project composes that rule itself.

## Reads

`Project` serves its own state through its `read` contract. `ProjectDirectory`, keyed by the constant `"projects"`, holds every project's slug, name and status by id. `ProjectDirectory.computed.ordered(state)` lists them by lowercased name, then slug, in code-unit order. Filtering by status is the reader's choice.
