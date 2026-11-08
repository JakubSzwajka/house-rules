import * as Domain from "@alchemy.run/domain";

export class CommentNotFound extends Domain.Rejection(
  "CommentNotFound",
  {},
  { httpApiStatus: 404 },
) {}
