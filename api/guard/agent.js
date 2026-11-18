import { guard, sendJson } from "../_lib.mjs";
import { isAddress } from "../../engine/checks.mjs";
import { agentIdOf } from "../../engine/rpc.mjs";

export default guard(async (req, res) => {
  const address = String(req.query.address || "");
  if (!isAddress(address)) return sendJson(res, 400, { error: "address must be an address" });
  sendJson(res, 200, await agentIdOf(address));
});
