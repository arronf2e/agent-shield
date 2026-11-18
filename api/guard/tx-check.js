import { guard, sendJson, readBody } from "../_lib.mjs";
import { txCheck, isAddress } from "../../engine/checks.mjs";
import { computeReportHash } from "../../engine/report.mjs";

export default guard(async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  const body = await readBody(req);
  const { from, to, value, data } = body || {};
  if (!isAddress(to || "")) return sendJson(res, 400, { error: "to must be an address" });
  if (from !== undefined && !isAddress(from)) return sendJson(res, 400, { error: "from must be an address" });
  const report = await txCheck({ from, to, value: String(value ?? "0"), data: data || "0x" });
  sendJson(res, 200, { ...report, reportHash: computeReportHash(report) });
});
