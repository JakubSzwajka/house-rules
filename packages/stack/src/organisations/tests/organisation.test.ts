import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { agent, person, PersonId, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import {
  AddMember,
  AdminRequired,
  AlreadyMember,
  aggregates,
  ChangeMemberRole,
  CreateOrganisation,
  LastAdmin,
  OrganisationMemberAdded,
  OrganisationMemberRemoved,
  OrganisationMemberRoleChanged,
  NotAdmin,
  NotMember,
  Organisation,
  OrganisationCreated,
  OrganisationExists,
  OrganisationNotFound,
  OrganisationsPermissions,
  OrgId,
  PersonOrganisations,
  RemoveMember,
  views,
} from "../index.ts";

class Organisations extends Domain.Model("Organisations", { aggregates, views }) {}

const story = Story.make(Organisations, {});
const acme = Organisation.ref(OrgId.make("acme"));
const globex = Organisation.ref(OrgId.make("globex"));
const ann = PersonId.make("ann");
const bob = PersonId.make("bob");
const carol = PersonId.make("carol");
const all = Object.values(OrganisationsPermissions);
const asPerson = (id: string) => Story.provide(CurrentActor, person(id, { permissions: all }));
const asClerk = Story.provide(CurrentActor, system("clerk", all));
const founded = Story.given(
  acme,
  new OrganisationCreated({ name: "Acme", admin: ann, by: ann }),
  new OrganisationMemberAdded({ person: bob, role: "member", by: ann }),
);

describe("Organisation", () => {
  it("the model is well defined", () => expect(Domain.verify(Organisations)).toEqual([]));

  it.effect("makes its creator the first admin", () =>
    story(
      asPerson("ann"),
      Story.when(acme, new CreateOrganisation({ name: "Acme" })),
      Story.then(acme, new OrganisationCreated({ name: "Acme", admin: ann, by: ann })),
      Story.state(acme, (s) =>
        expect(s).toEqual({ _tag: "Founded", name: "Acme", members: { ann: "admin" } }),
      ),
      Story.when(acme, new CreateOrganisation({ name: "Again" })),
      Story.rejected(new OrganisationExists()),
    ),
  );

  it.effect("refuses to create without the permission", () =>
    story(
      Story.provide(
        CurrentActor,
        person("ann", { permissions: [OrganisationsPermissions.manage] }),
      ),
      Story.when(acme, new CreateOrganisation({ name: "Acme" })),
      Story.rejected(new Forbidden({ permission: OrganisationsPermissions.create })),
    ),
  );

  it.effect("lets a system create for a named admin, and only for one", () =>
    story(
      asClerk,
      Story.when(acme, new CreateOrganisation({ name: "Acme" })),
      Story.rejected(new AdminRequired()),
      Story.when(acme, new CreateOrganisation({ name: "Acme", admin: ann })),
      Story.then(acme, new OrganisationCreated({ name: "Acme", admin: ann, by: "system:clerk" })),
    ),
  );

  it.effect("checks an agent as itself: never an admin by default, not a member", () =>
    story(
      founded,
      Story.provide(CurrentActor, agent("claude", "ann", { permissions: all })),
      Story.when(acme, new AddMember({ person: carol, role: "member" })),
      Story.rejected(new NotAdmin()),
      Story.when(acme, new RemoveMember({ person: bob })),
      Story.rejected(new NotAdmin()),
      Story.when(globex, new CreateOrganisation({ name: "Globex" })),
      Story.rejected(new AdminRequired()),
      Story.when(globex, new CreateOrganisation({ name: "Globex", admin: ann })),
      Story.then(globex, new OrganisationCreated({ name: "Globex", admin: ann, by: "claude" })),
    ),
  );

  it.effect("an admin adds a member, idempotently", () =>
    story(
      founded,
      asPerson("ann"),
      Story.when(acme, new AddMember({ person: carol, role: "member" })),
      Story.then(acme, new OrganisationMemberAdded({ person: carol, role: "member", by: ann })),
      Story.when(acme, new AddMember({ person: carol, role: "member" })),
      Story.then(acme),
      Story.when(acme, new AddMember({ person: carol, role: "admin" })),
      Story.rejected(new AlreadyMember({ person: carol, role: "member" })),
    ),
  );

  it.effect("refuses members who are not admins and strangers", () =>
    story(
      founded,
      asPerson("bob"),
      Story.when(acme, new AddMember({ person: carol, role: "member" })),
      Story.rejected(new NotAdmin()),
      asPerson("carol"),
      Story.when(acme, new RemoveMember({ person: bob })),
      Story.rejected(new NotAdmin()),
      Story.provide(CurrentActor, person("ann")),
      Story.when(acme, new AddMember({ person: carol, role: "member" })),
      Story.rejected(new Forbidden({ permission: OrganisationsPermissions.manage })),
    ),
  );

  it.effect("refuses to manage an organisation that was never created", () =>
    story(
      asPerson("ann"),
      Story.when(acme, new AddMember({ person: bob, role: "member" })),
      Story.rejected(new NotAdmin()),
      asClerk,
      Story.when(acme, new AddMember({ person: bob, role: "member" })),
      Story.rejected(new OrganisationNotFound()),
    ),
  );

  it.effect("an admin changes a member's role", () =>
    story(
      founded,
      asPerson("ann"),
      Story.when(acme, new ChangeMemberRole({ person: bob, role: "admin" })),
      Story.then(acme, new OrganisationMemberRoleChanged({ person: bob, role: "admin", by: ann })),
      Story.when(acme, new ChangeMemberRole({ person: bob, role: "admin" })),
      Story.then(acme),
      Story.when(acme, new ChangeMemberRole({ person: carol, role: "admin" })),
      Story.rejected(new NotMember({ person: carol })),
      Story.when(acme, new ChangeMemberRole({ person: ann, role: "member" })),
      Story.then(acme, new OrganisationMemberRoleChanged({ person: ann, role: "member", by: ann })),
      Story.state(acme, (s) =>
        expect(s).toEqual({
          _tag: "Founded",
          name: "Acme",
          members: { ann: "member", bob: "admin" },
        }),
      ),
    ),
  );

  it.effect("keeps at least one admin", () =>
    story(
      founded,
      asPerson("ann"),
      Story.when(acme, new ChangeMemberRole({ person: ann, role: "member" })),
      Story.rejected(new LastAdmin()),
      Story.when(acme, new RemoveMember({ person: ann })),
      Story.rejected(new LastAdmin()),
      asClerk,
      Story.when(acme, new RemoveMember({ person: ann })),
      Story.rejected(new LastAdmin()),
    ),
  );

  it.effect("an admin removes a member", () =>
    story(
      founded,
      asPerson("ann"),
      Story.when(acme, new RemoveMember({ person: bob })),
      Story.then(acme, new OrganisationMemberRemoved({ person: bob, by: ann })),
      Story.when(acme, new RemoveMember({ person: bob })),
      Story.rejected(new NotMember({ person: bob })),
      Story.state(acme, (s) =>
        expect(s).toEqual({ _tag: "Founded", name: "Acme", members: { ann: "admin" } }),
      ),
    ),
  );

  it.effect("a system with the permission manages any organisation", () =>
    story(
      founded,
      asClerk,
      Story.when(acme, new AddMember({ person: carol, role: "admin" })),
      Story.then(
        acme,
        new OrganisationMemberAdded({ person: carol, role: "admin", by: "system:clerk" }),
      ),
      Story.when(acme, new RemoveMember({ person: ann })),
      Story.then(acme, new OrganisationMemberRemoved({ person: ann, by: "system:clerk" })),
      Story.provide(CurrentActor, system("clerk")),
      Story.when(acme, new RemoveMember({ person: bob })),
      Story.rejected(new Forbidden({ permission: OrganisationsPermissions.manage })),
    ),
  );
});

describe("PersonOrganisations", () => {
  it.effect("lists each organisation a person belongs to, with their role", () =>
    story(
      founded,
      Story.given(
        globex,
        new OrganisationCreated({ name: "Globex", admin: bob, by: bob }),
        new OrganisationMemberAdded({ person: ann, role: "member", by: bob }),
      ),
      Story.view(PersonOrganisations, bob, (v) =>
        expect(v.organisations).toEqual({ acme: "member", globex: "admin" }),
      ),
      Story.view(PersonOrganisations, ann, (v) =>
        expect(v.organisations).toEqual({ acme: "admin", globex: "member" }),
      ),
      Story.given(
        acme,
        new OrganisationMemberRoleChanged({ person: bob, role: "admin", by: ann }),
        new OrganisationMemberRemoved({ person: ann, by: bob }),
      ),
      Story.view(PersonOrganisations, bob, (v) =>
        expect(v.organisations).toEqual({ acme: "admin", globex: "admin" }),
      ),
      Story.view(PersonOrganisations, ann, (v) =>
        expect(v.organisations).toEqual({ globex: "member" }),
      ),
      Story.view(PersonOrganisations, carol, Story.none),
    ),
  );
});
