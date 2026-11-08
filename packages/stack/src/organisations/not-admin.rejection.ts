import * as Domain from "@alchemy.run/domain";

export class NotAdmin extends Domain.Rejection("NotAdmin", {}, { httpApiStatus: 403 }) {}
