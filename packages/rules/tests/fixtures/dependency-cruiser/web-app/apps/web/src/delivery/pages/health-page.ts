import { connection } from "../../server/database";
export const health = () => connection;
