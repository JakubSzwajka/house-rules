import { route } from "@house-rules/application";
import { bookBooking } from "../../use-cases/book-booking.js";
import { addComment } from "../../use-cases/comments/add-comment.js";
import { editComment } from "../../use-cases/comments/edit-comment.js";
import { listComments } from "../../use-cases/comments/list-comments.js";
import { removeComment } from "../../use-cases/comments/remove-comment.js";
import { showBooking } from "../../use-cases/show-booking.js";
import { showPerson } from "../../use-cases/show-person.js";
import { bookingEndpoints } from "./endpoints.js";

export const bookingRoutes = [route(showBooking, bookingEndpoints.showBooking)] as const;

export const memberRoutes = [
  ...bookingRoutes,
  route(bookBooking, "POST /bookings", { status: 201 }),
  route(listComments),
  route(addComment),
  route(editComment),
  route(removeComment),
  route(showPerson, "GET /people/:id"),
] as const;
