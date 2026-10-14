import { mount } from "@house-rules/application";
import { bookBooking } from "../../use-cases/book-booking.js";
import { addComment } from "../../use-cases/comments/add-comment.js";
import { editComment } from "../../use-cases/comments/edit-comment.js";
import { listComments } from "../../use-cases/comments/list-comments.js";
import { removeComment } from "../../use-cases/comments/remove-comment.js";
import { devSignIn } from "../../use-cases/dev-sign-in.js";
import { showBooking } from "../../use-cases/show-booking.js";
import { showMe } from "../../use-cases/show-me.js";
import { showPerson } from "../../use-cases/show-person.js";
import { api, devApi, visitorApi } from "./api.js";

export const memberRoutes = mount(api, {
  showBooking,
  bookBooking,
  listComments,
  addComment,
  editComment,
  removeComment,
  showPerson,
  showMe,
});

export const visitorRoutes = mount(visitorApi, { showBooking });

export const devRoutes = mount(devApi, { signIn: devSignIn });
