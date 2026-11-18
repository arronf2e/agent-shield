// End-to-end smoke test against the running AgentShield server with real
// BSC addresses. Usage: node scripts/smoke-engine.mjs [baseUrl]
const B = process.argv[2] || "http://localhost:8787";
const W = "0x6D061974e66f5AF28C703DE5C1Ae33a671ded45F"; // shuyue.ai
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const PANCAKE = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const BEEF = "0x000000000000000000000000000000000000bEEF";

async function get(p) {
  const r = await fetch(B + p);
  return r.json();
}
async function post(p, body) {
  const r = await fetch(B + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
const brief = (name, j) =>
  console.log(
    name,
    "=> verdict",
    j.verdict,
    "| score",
    j.score,
    "| reasons:",
    (j.reasons || []).map((r) => r.code).join(","),
    j.error ? "| ERROR " + j.error : ""
  );

const a = await get("/api/guard/agent?address=" + W);
console.log("agent shuyue => handle:", a.handle, "| hasAgentId:", a.hasAgentId);
brief("contract USDT", await get("/api/guard/check?target=" + USDT));
brief("contract EOA(wallet)", await get("/api/guard/check?target=" + W));
const sw = await get("/api/guard/approvals?wallet=" + W);
brief("approvals sweep shuyue", sw);
console.log("  findings:", JSON.stringify(sw.findings));
brief("spender PancakeRouter", await get(`/api/guard/approvals?wallet=${W}&spender=${PANCAKE}&token=${USDT}`));
brief("spender beef(EOA)", await get(`/api/guard/approvals?wallet=${W}&spender=${BEEF}&token=${USDT}`));

const padA = (addr) => "0x095ea7b3" + addr.toLowerCase().replace("0x", "").padStart(64, "0");
const max = ((1n << 256n) - 1n).toString(16).padStart(64, "0");
const zero = "0".padStart(64, "0");
brief("tx unlimited approve->beef", await post("/api/guard/tx-check", { from: W, to: USDT, value: "0", data: padA(BEEF) + max }));
brief("tx revoke approve 0 ->beef", await post("/api/guard/tx-check", { from: W, to: USDT, value: "0", data: padA(BEEF) + zero }));
brief("tx unlimited approve->Pancake", await post("/api/guard/tx-check", { from: W, to: USDT, value: "0", data: padA(PANCAKE) + max }));
brief("tx setApprovalForAll", await post("/api/guard/tx-check", { from: W, to: USDT, value: "0", data: "0xa22cb465" + "beef".padStart(64, "0") + "1".padStart(64, "0") }));
brief("tx plain BNB transfer", await post("/api/guard/tx-check", { from: W, to: "0x000000000000000000000000000000000000dEaD", value: "1000000000000000", data: "0x" }));
