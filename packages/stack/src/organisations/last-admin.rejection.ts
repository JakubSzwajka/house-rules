import * as Domain from "@alchemy.run/domain";

export class LastAdmin extends Domain.Rejection("LastAdmin", {}, { httpApiStatus: 409 }) {}
