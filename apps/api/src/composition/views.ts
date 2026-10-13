import type { BookingNotFound, BookingStoreUnavailable } from "@hosti/bookings";
import { problemView } from "@house-rules/capability";
import type {
  CommentInputInvalid,
  CommentStoreUnavailable,
  CommentTargetNotFound,
  CommentTargetsUnavailable,
} from "@house-rules/comments";

export const commentViews = {
  CommentInputInvalid: problemView(
    400,
    "invalid_input",
    (_error: CommentInputInvalid) => "Invalid comment input.",
  ),
  CommentTargetNotFound: problemView(
    404,
    "not_found",
    (_error: CommentTargetNotFound) => "Comment target was not found.",
  ),
  CommentStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: CommentStoreUnavailable) => "Comments are unavailable right now.",
  ),
  CommentTargetsUnavailable: problemView(
    503,
    "unavailable",
    (_error: CommentTargetsUnavailable) => "Comment targets are unavailable right now.",
  ),
};

export const bookingViews = {
  ...commentViews,
  BookingNotFound: problemView(
    404,
    "not_found",
    (error: BookingNotFound) => `Booking ${error.id} was not found.`,
    { exposeCode: true },
  ),
  BookingStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: BookingStoreUnavailable) => "Bookings are unavailable right now.",
  ),
};
