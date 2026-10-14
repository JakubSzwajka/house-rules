import { bookBookingContract, showBookingContract } from "@example/bookings/contract";
import { devSignInContract, showMeContract } from "@example/dev-sign-in/contract";
import { defineApi, endpoint } from "@house-rules/application/contract";
import {
  addComment,
  editComment,
  listComments,
  removeComment,
} from "@house-rules/comments/contract";
import { showPerson } from "@house-rules/party/contract";

export const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBookingContract, "GET /bookings/:id", { codes: ["not_found"] }),
    bookBooking: endpoint(bookBookingContract, "POST /bookings", {
      status: 201,
      codes: ["conflict"],
    }),
    listComments: endpoint(listComments, undefined, { codes: ["not_found"] }),
    addComment: endpoint(addComment, undefined, { codes: ["not_found", "invalid_input"] }),
    editComment: endpoint(editComment, undefined, { codes: ["not_found", "invalid_input"] }),
    removeComment: endpoint(removeComment, undefined, { codes: ["not_found"] }),
    showPerson: endpoint(showPerson, "GET /people/:id", { codes: ["not_found"] }),
    showMe: endpoint(showMeContract, "GET /me", { codes: ["not_found"] }),
  },
);

export const visitorApi = defineApi({ prefix: "/api" }, { showBooking: api.endpoints.showBooking });

export const devApi = defineApi(
  { prefix: "/api/dev" },
  { signIn: endpoint(devSignInContract, "POST /sign-in", { codes: ["not_found"] }) },
);
