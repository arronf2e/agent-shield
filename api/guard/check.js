import { guard, sendJson } from "../_lib.mjs";
import { contractCheck, isAddress } from "../../engine/checks.mjs";
import { computeReportHash } from "../../engine/report.mjs";

export default guard(async (req, res) => {
  const target = String(req.query.target || "");
  if (!isAddress(target)) return sendJson(res, 400, { error: "target must be an address" });
  const report = await contractCheck(target);
  sendJson(res, 200, { ...report, reportHash: computeReportHash(report) });
});
