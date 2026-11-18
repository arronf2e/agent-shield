import { guard, sendJson } from "../_lib.mjs";
import { getBlocklist } from "../../engine/registry.mjs";

export default guard(async (req, res) => {
  sendJson(res, 200, await getBlocklist());
});
