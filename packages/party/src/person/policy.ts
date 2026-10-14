import { definePolicy } from "@house-rules/domain";
import { PartyPermissions } from "./permissions.js";

export const personPolicy = definePolicy({
  self: [PartyPermissions.read, PartyPermissions.update],
  other: [PartyPermissions.read],
});
