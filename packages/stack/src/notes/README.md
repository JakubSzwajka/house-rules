# Notes

Immutable plain-text notes on an app's own objects ("targets"). One `Note` aggregate per note, keyed by a `NoteId` the caller picks, carrying its target `{ kind, id }` (`Target`, from the package root, shared with comments). `NotesOnTarget` is a view keyed by `targetKey(target)` (`"kind/id"`) that lists a target's notes oldest first (by time added, then id), with `addedAt` in epoch milliseconds.

```ts
class App extends Domain.Model("App", {
  aggregates: [...Notes.aggregates, Booking],
  views: [...Notes.views],
}) {}
```

| Block | Permission | Rule |
| --- | --- | --- |
| `AddNote { target, body }` | `notes:write` | body at most 4000 UTF-16 units (`NoteTooLong`); a note is written once (`NoteExists` on a used id) |
| `NotesOnTarget` | `notes:read` | the view, through `Session` |

There is no edit or delete: a note is a record. `NoteAdded` carries `by` (`authorOf(actor)`), the target and the body; it is the fact the old module returned to features.

Notes are not comments with a flag. They share the shape of a target-keyed list, but their rule is the opposite (write once versus author-edit and moderated delete), their permissions are separate, and the whole module is one command. Merging would add a policy switch to every comments rule to save four short files.

## Target access

As in comments: `decide` cannot ask the host about the target, so the module checks `notes:write` and `notes:read`, and the host decides which targets a person reaches. Expose the command and view in the app's Api as they are when every holder of the permissions may see every target; otherwise front them with the host's own guarded command and view. See `../comments/README.md`.

## What the host owns

- Target kinds (lowercase slugs) and ids.
- Rendering. Bodies are plain text.
