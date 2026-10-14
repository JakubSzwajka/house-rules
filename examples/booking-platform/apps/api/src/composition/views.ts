import type {
  BookingAlreadyCancelled,
  BookingAlreadyExists,
  BookingNotFound,
  BookingStoreUnavailable,
} from "@example/bookings";
import { problemView } from "@house-rules/application";
import type { AuthJwtConfigInvalid } from "@house-rules/auth-jwt";
import type {
  CommentInputInvalid,
  CommentStoreUnavailable,
  CommentTargetNotFound,
  CommentTargetsUnavailable,
} from "@house-rules/comments";
import type { PersonNotFound, PersonStoreUnavailable } from "@house-rules/party";
import type { SqlError } from "effect/sql/SqlError";

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

export const personViews = {
  PersonNotFound: problemView(
    404,
    "not_found",
    (_error: PersonNotFound) => "That person was not found.",
  ),
  PersonStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: PersonStoreUnavailable) => "People are unavailable right now.",
  ),
};

export const bookingViews = {
  ...commentViews,
  ...personViews,
  BookingNotFound: problemView(
    404,
    "not_found",
    (error: BookingNotFound) => `Booking ${error.id} was not found.`,
    { exposeCode: true },
  ),
  BookingAlreadyExists: problemView(
    409,
    "conflict",
    (error: BookingAlreadyExists) => `Booking ${error.id} already exists.`,
  ),
  BookingAlreadyCancelled: problemView(
    409,
    "conflict",
    (error: BookingAlreadyCancelled) => `Booking ${error.id} is already cancelled.`,
  ),
  BookingStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: BookingStoreUnavailable) => "Bookings are unavailable right now.",
  ),
  AuthJwtConfigInvalid: problemView(
    503,
    "unavailable",
    (_error: AuthJwtConfigInvalid) => "Sign-in is not set up correctly on this server.",
  ),
  SqlError: problemView(503, "unavailable", (_error: SqlError) => "The database is unavailable."),
};
