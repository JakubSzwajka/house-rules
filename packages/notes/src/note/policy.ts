import { definePolicy } from "@house-rules/domain";
import { NotePermissions } from "./permissions.js";
export const notePolicy = definePolicy({
  owner: [NotePermissions.read, NotePermissions.write],
  member: [NotePermissions.read, NotePermissions.write],
  none: [],
});
