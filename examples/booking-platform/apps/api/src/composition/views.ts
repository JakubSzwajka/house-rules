import type {
  AccountEmailTaken,
  AccountInputInvalid,
  AccountsIssuerConfigInvalid,
  AccountStoreUnavailable,
  InvalidCredentials,
} from "@example/accounts";
import type { ActivityUnavailable } from "@example/activity";
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
import type {
  PersonInputInvalid,
  PersonNotFound,
  PersonStoreUnavailable,
  PersonUpdateRefused,
} from "@house-rules/party";
import type { SqlError } from "effect/sql/SqlError";

export const commentViews = {
  CommentInputInvalid: problemView(
    400,
    "invalid_input",
    (_error: CommentInputInvalid) => "Invalid comment input.",
    { exposeCode: true },
  ),
  CommentTargetNotFound: problemView(
    404,
    "not_found",
    (_error: CommentTargetNotFound) => "Comment target was not found.",
    { exposeCode: true },
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
    { exposeCode: true },
  ),
  PersonInputInvalid: problemView(
    400,
    "invalid_input",
    (_error: PersonInputInvalid) => "A display name has 1 to 120 characters.",
    { exposeCode: true },
  ),
  PersonUpdateRefused: problemView(
    403,
    "forbidden",
    (_error: PersonUpdateRefused) => "You may rename only yourself.",
    { exposeCode: true },
  ),
  PersonStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: PersonStoreUnavailable) => "People are unavailable right now.",
  ),
};

export const accountViews = {
  InvalidCredentials: problemView(
    401,
    "invalid_credentials",
    (_error: InvalidCredentials) => "That email and password do not match an account.",
    { exposeCode: true },
  ),
  AccountInputInvalid: problemView(
    400,
    "invalid_input",
    (error: AccountInputInvalid) => error.message,
    { exposeCode: true },
  ),
  AccountEmailTaken: problemView(
    409,
    "taken",
    (_error: AccountEmailTaken) => "That email already has an account.",
    { exposeCode: true },
  ),
  AccountStoreUnavailable: problemView(
    503,
    "unavailable",
    (_error: AccountStoreUnavailable) => "Accounts are unavailable right now.",
  ),
  AccountsIssuerConfigInvalid: problemView(
    503,
    "unavailable",
    (_error: AccountsIssuerConfigInvalid) => "Sign-in is not set up correctly on this server.",
  ),
};

export const activityViews = {
  ActivityUnavailable: problemView(
    503,
    "unavailable",
    (_error: ActivityUnavailable) => "Your activity is unavailable right now.",
  ),
};

export const bookingViews = {
  ...commentViews,
  ...personViews,
  ...accountViews,
  ...activityViews,
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
    { exposeCode: true },
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
