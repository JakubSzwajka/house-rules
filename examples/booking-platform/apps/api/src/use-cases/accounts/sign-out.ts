import { signOutContract } from "@example/accounts";
import { implement } from "@house-rules/application";
import { Effect } from "effect";

export const signOut = implement(signOutContract, () => Effect.succeed({}));
