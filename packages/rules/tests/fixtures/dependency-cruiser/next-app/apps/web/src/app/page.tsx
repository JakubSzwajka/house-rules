import { app } from "../composition/index";
import { showItem } from "../use-cases/show-item";
export default function Page() {
  return showItem(app.name);
}
