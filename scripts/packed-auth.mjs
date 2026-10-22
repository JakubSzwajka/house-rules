const issuer = "https://issuer.packed.test";
const audience = "https://api.packed.test";

export const authConsumerFiles = {
  "auth.mjs": `import assert from "node:assert/strict";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { CurrentActor, defineFeature, May, Runtime, runFeature, StepTrace } from "@house-rules/application";
import { AuthJwt, AuthJwtTesting } from "@house-rules/auth-jwt";
import { Identity } from "@house-rules/identity";
import { Party, PartyMount } from "@house-rules/party";
import * as contract from "@house-rules/party/contract";
import { NodeRuntime as NodePlatform } from "@effect/platform-node";
import { Effect, Layer } from "effect";
const issuer = ${JSON.stringify(issuer)};
const audience = ${JSON.stringify(audience)};
const show = defineFeature("packed_show_person", { description: "Show a person.", input: contract.PartyOperations.showPerson.input, output: contract.PartyOperations.showPerson.output, failure: contract.PartyOperations.showPerson.failure, permission: null, flags: { readOnly: true }, edges: [contract.PartyOperations.showPerson], handler: (input, { call }) => call(contract.PartyOperations.showPerson, input) });
const rename = defineFeature("packed_rename_person", { description: "Rename a person.", input: contract.PartyOperations.renamePerson.input, output: contract.PartyOperations.renamePerson.output, failure: contract.PartyOperations.renamePerson.failure, permission: null, edges: [contract.PartyOperations.renamePerson], handler: (input, { call }) => call(contract.PartyOperations.renamePerson, input) });
const features = [show, rename];
const who = Identity.who({ token: "bearer", audience });
const incoming = (token) => ({ headers: new Headers({ authorization: \`Bearer \${token}\` }), url: \`\${audience}/\` });
NodePlatform.runMain(Effect.gen(function* () {
  const keys = yield* AuthJwtTesting.keys;
  const signIn = Layer.mergeAll(AuthJwt.layer({ issuer, jwks: keys.jwks }), Identity.subject({ issuer }), Identity.refuse);
  const token = yield* keys.sign({ iss: issuer, sub: "packed-user", aud: audience });
  const actor = yield* who.resolve(incoming(token)).pipe(Effect.provide(signIn));
  assert.equal(actor.id, "packed-user");
  const foreign = yield* keys.sign({ iss: "https://other.packed.test", sub: "packed-user", aud: audience });
  const wrongAudience = yield* keys.sign({ iss: issuer, sub: "packed-user", aud: "https://other.packed.test" });
  for (const bad of ["not-a-jwt", foreign, wrongAudience]) {
    const refused = yield* Effect.flip(who.resolve(incoming(bad)).pipe(Effect.provide(signIn)));
    assert.equal(refused.code, "token_invalid");
  }
  const party = yield* Party;
  yield* UnitOfWork.atomic(party.createPerson({ id: actor.id, displayName: " Packed " }));
  const runtime = Runtime.layer({ features, ways: [], mounts: [PartyMount] }).pipe(Layer.provide(Layer.succeed(Party, party)));
  const may = Layer.succeedContext(May.context(May.fixed(Object.values(contract.PartyPermissions)), { features, system: [], via: "packed" }));
  const as = (viewer) => Layer.mergeAll(runtime, StepTrace.layer(), may, Layer.succeed(CurrentActor, viewer));
  const person = yield* runFeature(show, { id: actor.id }).pipe(Effect.provide(as(actor)));
  assert.equal(person.displayName, "Packed");
  const outsider = Actor.make({ id: ActorId.make("outsider") });
  const denied = yield* Effect.flip(runFeature(rename, { id: actor.id, displayName: "Stolen" }).pipe(Effect.provide(as(outsider))));
  assert.equal(denied._tag, "PersonUpdateRefused");
  assert.equal((yield* party.get(actor, actor.id)).displayName, "Packed");
  yield* Effect.log("cold install: signed JWT, issuer/audience refusals, Identity.who, bound Party app features and person policy pass");
}).pipe(Effect.provide(Layer.merge(Party.layerMemory({ builtInRoles: {} }), memoryUnitOfWork))));
`,
  "auth.ts": `import { type Incoming, type Principal, tokenFrom } from "@house-rules/application";
import { errorKind, defineOperation } from "@house-rules/domain/contract";
import { AuthJwt, type AuthJwtOptions } from "@house-rules/auth-jwt";
import { Identity, type IdentityWhoOptions } from "@house-rules/identity";
import { Party, bindParty, type PartyFailure } from "@house-rules/party";
import { type Person, PartyOperations } from "@house-rules/party/contract";
import { Effect, Schema } from "effect";
export const options: AuthJwtOptions = { issuer: ${JSON.stringify(issuer)}, audience: ${JSON.stringify(audience)} };
export const authenticator = AuthJwt.layer(options);
export const clerk = AuthJwt.clerk({ publishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k" });
export const whoOptions: IdentityWhoOptions = { token: { cookie: "__session" } };
export const who = Identity.who(whoOptions);
export const token = (incoming: Incoming) => tokenFrom(incoming, "bearer");
export const subject = (principal: Principal): string => principal.subject;
export const bind = (service: Party["Service"]) => bindParty(service);
export const operations = Object.values(PartyOperations);
export const name = (person: Person): string => person.displayName;
export const failureTag = (failure: PartyFailure): string => failure._tag;
export class Missing extends Schema.TaggedError<Missing>()("Missing", { kind: errorKind("not_found") }) {}
export const missing: Missing = new Missing();
export const kind: "not_found" = missing.kind;
export const proof = defineOperation("kind_proof", { description: "Packed kind declaration.", input: Schema.Struct({}), output: Schema.String, failure: Missing, permission: null });
class Unkinded extends Schema.TaggedError<Unkinded>()("Unkinded", {}) {}
// @ts-expect-error every failure needs an error kind
 defineOperation("unkinded", { description: "Rejected.", input: Schema.Struct({}), output: Schema.String, failure: Unkinded, permission: null });
// @ts-expect-error Party.get needs the acting Actor
export const anonymous = Effect.gen(function* () { return yield* (yield* Party).get("packed-user"); });
`,
};

export function assertPackedAuth(app, { run }) {
  run(process.execPath, ["--no-experimental-strip-types", "auth.mjs"], app);
}
