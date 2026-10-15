import {
  changePasswordContract,
  signInContract,
  signOutContract,
  signUpContract,
} from "@example/accounts/contract";
import { listMyActivityContract } from "@example/activity/contract";
import {
  bookBookingContract,
  listMyBookingsContract,
  showBookingContract,
} from "@example/bookings/contract";
import { defineApi, endpoint } from "@house-rules/application/contract";
import {
  addComment,
  editComment,
  listComments,
  removeComment,
} from "@house-rules/comments/contract";
import { renamePerson, showMe, showPerson } from "@house-rules/party/contract";

export const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBookingContract, "GET /bookings/:id", { codes: ["not_found"] }),
    bookBooking: endpoint(bookBookingContract, "POST /bookings", {
      status: 201,
      codes: ["conflict"],
    }),
    listMyBookings: endpoint(listMyBookingsContract, "GET /my/bookings"),
    listComments: endpoint(listComments, undefined, { codes: ["not_found"] }),
    addComment: endpoint(addComment, undefined, { codes: ["not_found", "invalid_input"] }),
    editComment: endpoint(editComment, undefined, { codes: ["not_found", "invalid_input"] }),
    removeComment: endpoint(removeComment, undefined, { codes: ["not_found"] }),
    showPerson: endpoint(showPerson, "GET /people/:id", { codes: ["not_found"] }),
    showMe: endpoint(showMe, "GET /me", { codes: ["not_found"] }),
    renamePerson: endpoint(renamePerson, "POST /me/name", {
      codes: ["invalid_input", "forbidden", "not_found"],
    }),
    changePassword: endpoint(changePasswordContract, "POST /me/password", {
      codes: ["invalid_credentials", "invalid_input"],
    }),
    listMyActivity: endpoint(listMyActivityContract, "GET /my/activity"),
  },
);

export const publicApi = defineApi(
  { prefix: "/api" },
  {
    signUp: endpoint(signUpContract, "POST /sign-up", {
      status: 201,
      codes: ["invalid_input", "taken"],
      session: "issue",
    }),
    signIn: endpoint(signInContract, "POST /sign-in", {
      codes: ["invalid_credentials"],
      session: "issue",
    }),
    signOut: endpoint(signOutContract, "POST /sign-out", { session: "clear" }),
  },
);

export const tokenApi = defineApi(
  { prefix: "/api" },
  { signIn: endpoint(signInContract, "POST /token", { codes: ["invalid_credentials"] }) },
);

export const publicPaths: ReadonlySet<string> = new Set(
  [publicApi, tokenApi].flatMap((list) =>
    Object.values(list.endpoints).map((shape) => `${list.prefix}${shape.path}`),
  ),
);
