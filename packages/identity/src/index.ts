export { Identity, type Login } from "./facade.js";
export { BindingStore } from "./storage.js";
export {
  Binding,
  BindingInvalid,
  BindingKey,
  BindingTaken,
  IdentityStoreUnavailable,
} from "./binding/binding.js";
export {
  ActorResolver,
  ForeignIssuer,
  type ActorResolverService,
} from "./sign-in/actor-resolver.js";
export { FirstSignIn, type FirstSignInService } from "./sign-in/first-sign-in.js";
export {
  type IdentityCaller,
  type IdentityCallerOptions,
  identityCaller,
} from "./sign-in/caller.js";
export { memoryBindingStore } from "./adapters/memory/binding.js";
export { postgresBindingStore } from "./adapters/postgres/binding.js";
