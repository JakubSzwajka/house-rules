import type { BookingNotFound, BookingStoreUnavailable } from "@example/bookings";
import { problemView } from "@house-rules/application";
import type {
  CommentInputInvalid,
  CommentStoreUnavailable,
  CommentTargetNotFound,
  CommentTargetsUnavailable,
} from "@house-rules/comments";

export const mcpViews = {
  BookingNotFound: problemView(
    404,
    "not_found",
    (error: BookingNotFound) => `No booking with id ${error.id} is visible to you.`,
  ),
  BookingStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: BookingStoreUnavailable) => "Bookings are unavailable. Try again later.",
  ),
  CommentInputInvalid: problemView(
    400,
    "invalid_input",
    (_error: CommentInputInvalid) => "The comment request is not valid.",
  ),
  CommentTargetNotFound: problemView(
    404,
    "not_found",
    (_error: CommentTargetNotFound) => "No such booking is visible to you.",
  ),
  CommentStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: CommentStoreUnavailable) => "Comments are unavailable. Try again later.",
  ),
  CommentTargetsUnavailable: problemView(
    503,
    "unavailable",
    (_error: CommentTargetsUnavailable) => "Comments are unavailable. Try again later.",
  ),
};
