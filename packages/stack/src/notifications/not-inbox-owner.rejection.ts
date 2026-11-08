import * as Domain from "@alchemy.run/domain";

export class NotInboxOwner extends Domain.Rejection("NotInboxOwner", {}, { httpApiStatus: 403 }) {}
