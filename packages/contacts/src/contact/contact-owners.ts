import type { Actor } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { ContactOwner, ContactOwnersUnavailable } from "./contact.js";
export type ContactAccess = "write" | "read" | "none";
export class ContactOwners extends Context.Service<
  ContactOwners,
  {
    readonly access: (
      actor: Actor,
      owner: ContactOwner,
    ) => Effect.Effect<ContactAccess, ContactOwnersUnavailable>;
  }
>()("@house-rules/contacts/ContactOwners") {}
