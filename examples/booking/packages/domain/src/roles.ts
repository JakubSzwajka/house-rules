import { type RoleDefinitions, system } from "@house-rules/stack";
import { BookingPermissions, PaymentPermissions } from "./permissions.ts";

const member = [BookingPermissions.make, BookingPermissions.cancel, BookingPermissions.read];

export const BookingRoles = {
  member,
  "org-admin": [...member, BookingPermissions.cancelForOrg],
  guest: [],
} satisfies RoleDefinitions;

export const billing = system("billing", [PaymentPermissions.settle]);
