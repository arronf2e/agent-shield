// AgentShield API + static web server (no framework, Node >= 18).
//
// Machine-readable guard API — this is the interface other AI agents call
// BEFORE executing a transaction with Binance Agentic Wallet:
//
//   GET  /api/guard/check?target=0x...            contract check
//   GET  /api/guard/approvals?wallet=0x...        approval sweep
//   GET  /api/guard/approvals?wallet=0x...&spender=0x...[&token=0x...]
//                                                 spender risk check
//   POST /api/guard/tx-check  {from,to,value,data}  transaction pre-flight
//   GET  /api/guard/agent?address=0x...           Agent ID lookup (handleOf)
//
// Every report carries `verdict` (ALLOW | WARN | BLOCK), `score` (0-100),
// human-readable `reasons`, and `reportHash` — the keccak256 of the canonical
// report, ready to anchor on-chain via GuardRegistry.recordCheck().
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { contractCheck, approvalCheck, txCheck, isAddress } from "../engine/checks.mjs";
import { agentIdOf } from "../engine/rpc.mjs";
import { getBlocklist, getLeaderboard } from "../engine/registry.mjs";
import { withHash } from "../engine/report.mjs";

const WEB_DIR = fileURLToPath(new URL("../web", import.meta.url));
const PORT = Number(process.env.PORT || 8787);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/api/guard/check") {
      const target = url.searchParams.get("target") || "";
      if (!isAddress(target)) return sendJson(res, 400, { error: "target must be an address" });
      return sendJson(res, 200, withHash(await contractCheck(target)));
    }
    if (path === "/api/guard/approvals") {
      const wallet = url.searchParams.get("wallet") || "";
      const spender = url.searchParams.get("spender") || undefined;
      const token = url.searchParams.get("token") || undefined;
      if (!isAddress(wallet)) return sendJson(res, 400, { error: "wallet must be an address" });
      return sendJson(res, 200, withHash(await approvalCheck({ wallet, spender, token })));
    }
    if (path === "/api/guard/tx-check" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!isAddress(body.to || "")) return sendJson(res, 400, { error: "to must be an address" });
      return sendJson(res, 200, withHash(await txCheck(body)));
    }
    if (path === "/api/guard/blocklist") {
      return sendJson(res, 200, await getBlocklist());
    }
    if (path === "/api/guard/leaderboard") {
      return sendJson(res, 200, await getLeaderboard());
    }
    if (path === "/api/guard/agent") {
      const address = url.searchParams.get("address") || "";
      if (!isAddress(address)) return sendJson(res, 400, { error: "address must be an address" });
      return sendJson(res, 200, await agentIdOf(address));
    }
    if (path.startsWith("/api/")) return sendJson(res, 404, { error: "unknown api route" });

    // Static web
    const rel = path === "/" ? "index.html" : path.slice(1);
    const file = normalize(join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR)) return sendJson(res, 403, { error: "forbidden" });
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e.code === "ENOENT") return sendJson(res, 404, { error: "not found" });
    return sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`AgentShield running at http://localhost:${PORT}`);
});
