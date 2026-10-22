import { ActorId } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const Invitation = Schema.Struct({
  id: Schema.String,
  organisationId: Schema.String,
  roleKey: Schema.NullOr(Schema.String),
  createdBy: ActorId,
  expiresAt: Schema.Finite,
  state: Schema.Literals(["pending", "used", "revoked"]),
});
export type Invitation = typeof Invitation.Type;
export const StoredInvitation = Schema.Struct({ ...Invitation.fields, codeHash: Schema.String });
export type StoredInvitation = typeof StoredInvitation.Type;
export const InvitationAcceptance = Schema.Struct({
  organisationId: Schema.String,
  roleKey: Schema.NullOr(Schema.String),
  personId: ActorId,
});
export const CreatedInvitation = Schema.Struct({ invitation: Invitation, code: Schema.String });
