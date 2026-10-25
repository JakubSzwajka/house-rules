import { format } from "./helpers/format";
import { label } from "./misc";
import { pad } from "./string-utils";
import { share } from "./shared";
import { util } from "./utilities";
export const Route = () => <p>{format(label + pad + share + util)}</p>;
