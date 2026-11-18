import { guard, sendJson } from "../_lib.mjs";
import { approvalCheck, isAddress } from "../../engine/checks.mjs";
import { computeReportHash } from "../../engine/report.mjs";

export default guard(async (req, res) => {
  const wallet = String(req.query.wallet || "");
  const spender = req.query.spender ? String(req.query.spender) : undefined;
  const token = req.query.token ? String(req.query.token) : undefined;
  if (!isAddress(wallet)) return sendJson(res, 400, { error: "wallet must be an address" });
  if (spender !== undefined && !isAddress(spender)) return sendJson(res, 400, { error: "spender must be an address" });
  if (token !== undefined && !isAddress(token)) return sendJson(res, 400, { error: "token must be an address" });
  const report = await approvalCheck(wallet, { spender, token });
  sendJson(res, 200, { ...report, reportHash: computeReportHash(report) });
});
