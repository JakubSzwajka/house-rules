import { mount } from "@house-rules/application";
import { changePassword } from "../../use-cases/accounts/change-password.js";
import { signIn } from "../../use-cases/accounts/sign-in.js";
import { signOut } from "../../use-cases/accounts/sign-out.js";
import { signUp } from "../../use-cases/accounts/sign-up.js";
import { bookBooking } from "../../use-cases/book-booking.js";
import { addComment } from "../../use-cases/comments/add-comment.js";
import { editComment } from "../../use-cases/comments/edit-comment.js";
import { listComments } from "../../use-cases/comments/list-comments.js";
import { removeComment } from "../../use-cases/comments/remove-comment.js";
import { listMyActivity } from "../../use-cases/list-my-activity.js";
import { listMyBookings } from "../../use-cases/list-my-bookings.js";
import { renamePerson } from "../../use-cases/rename-person.js";
import { showBooking } from "../../use-cases/show-booking.js";
import { showMe } from "../../use-cases/show-me.js";
import { showPerson } from "../../use-cases/show-person.js";
import { api, publicApi, tokenApi } from "./api.js";

export const memberRoutes = mount(api, {
  showBooking,
  bookBooking,
  listMyBookings,
  listComments,
  addComment,
  editComment,
  removeComment,
  showPerson,
  showMe,
  renamePerson,
  changePassword,
  listMyActivity,
});

export const publicRoutes = [
  ...mount(publicApi, { signUp, signIn, signOut }),
  ...mount(tokenApi, { signIn }),
];
