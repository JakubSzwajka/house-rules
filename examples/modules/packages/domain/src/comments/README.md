# Comments

Flat, plain-text comments on an app's own objects ("targets"). One `Comment` aggregate per comment, keyed by a `CommentId` the caller picks, carrying its target `{ kind, id }` (`Target`, from the package root, shared with notes). `CommentsOnTarget` is a view keyed by `targetKey(target)` (`"kind/id"`) that lists a target's live comments oldest first (by posted time, then id), with `postedAt` and `editedAt` in epoch milliseconds.

```ts
class App extends Domain.Model("App", {
  aggregates: [...Comments.aggregates, Booking],
  views: [...Comments.views],
}) {}
```

| Command | Permission | Rule |
| --- | --- | --- |
| `AddComment { target, body }` | `comments:write` | body at most 4000 UTF-16 units (`CommentTooLong`); an id is never reused (`CommentExists`) |
| `EditComment { body }` | `comments:write` | only the author (`NotAuthor`), and an agent is its own author, not its person; same length limit; `CommentNotFound` when missing or deleted |
| `DeleteComment` | `comments:write` | the author, or anyone holding `comments:moderate` (`NotAuthor` otherwise); deleting a deleted comment records nothing |

Reading `CommentsOnTarget` needs `comments:read`. Every command and the view go through `Session`; a missing permission is `Forbidden`. Events carry `by` and `for` (`attributionOf(actor)`: the author, and the person an agent acted for or `null`) and the target, and `CommentsOnTarget` shows both, so the view and any host policy can route them.

## Target access

The old module asked a host port, per call, whether the person was owner, member or stranger of the target. `decide` cannot call ports, and a comment does not own its target, so the module cannot know that. Instead:

- The owner/member split becomes permissions the host's `Roles` grant: members get `comments:read` and `comments:write`, owners and moderators also `comments:moderate`.
- Authorship lives in the aggregate's state and is checked in `decide`.
- Which targets a person may reach is the host's call, made where the host already knows it. If any holder of the permissions may see any target in the app, list the module's commands and view in the app's Api as they are. If targets are private to their members, do not expose them raw: put a guarded command and view on the host's own aggregate (which knows its members), or serve the comments through a host Api whose `validate` checks the target.

This keeps the module free of host ports and keeps every rule a story can check.

## What the host owns

- Target kinds and ids. Kinds are lowercase slugs (`booking`, `work-item`), so `"kind/id"` keys never collide.
- Removing a target's comments: on its own deletion event, a host policy reads `CommentsOnTarget` and sends `DeleteComment` to each id as `system(name, ["comments:write", "comments:moderate"])`.
- Rendering. Bodies are plain text.
