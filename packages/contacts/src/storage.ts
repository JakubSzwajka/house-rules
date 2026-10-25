import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type {
  Contact,
  ContactConflict,
  ContactCursor,
  ContactOwner,
  ContactStoreUnavailable,
  ContactType,
} from "./contact/contact.js";
export type PrimarySelection = {
  readonly contact: Contact;
  readonly previousContactIds: Readonly<Record<string, string | null>>;
};
type WriteFailure = ContactStoreUnavailable | NoOpenUnit;
export class ContactStore extends Context.Service<
  ContactStore,
  {
    readonly get: (id: string) => Effect.Effect<Contact | undefined, ContactStoreUnavailable>;
    readonly list: (
      owner: ContactOwner,
      page: { readonly size: number; readonly after?: ContactCursor },
    ) => Effect.Effect<ReadonlyArray<Contact>, ContactStoreUnavailable>;
    readonly primaryFor: (
      owner: ContactOwner,
      type: ContactType,
      purpose: string,
      verifiedOnly: boolean,
    ) => Effect.Effect<Contact | undefined, ContactStoreUnavailable>;
    readonly insert: (contact: Contact) => Effect.Effect<void, WriteFailure | ContactConflict>;
    readonly remove: (id: string) => Effect.Effect<boolean, WriteFailure>;
    readonly setPrimary: (
      id: string,
      purposes?: ReadonlyArray<string>,
    ) => Effect.Effect<PrimarySelection | undefined, WriteFailure>;
    readonly importVerified: (contact: Contact) => Effect.Effect<
      {
        readonly contact: Contact;
        readonly added: boolean;
        readonly verified: boolean;
      },
      WriteFailure
    >;
    readonly replaceToken: (
      id: string,
      hash: string,
      expiresAt: number,
    ) => Effect.Effect<boolean, WriteFailure>;
    readonly consumeToken: (
      hash: string,
      now: number,
    ) => Effect.Effect<Contact | undefined, WriteFailure>;
    readonly erase: (owner: ContactOwner) => Effect.Effect<void, WriteFailure>;
  }
>()("@house-rules/contacts/ContactStore") {}
