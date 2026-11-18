// Minimal BSC JSON-RPC client (no dependencies, fetch-based).
// Endpoints verified reachable on 2026-11-18. publicnode first (it also
// serves the Agent ID tooling), Binance dataseed as fallback.
const ENDPOINTS = (
  process.env.BSC_RPC_URLS ||
  "https://bsc-dataseed.binance.org,https://bsc-dataseed1.binance.org,https://bsc-rpc.publicnode.com"
).split(",");

let nextId = 1;

export async function rpc(method, params) {
  // One full pass over the endpoints, then a single retry pass after a
  // short pause if everything failed on rate limits / transport errors.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await rpcOnce(method, params);
    if (result.ok) return result.value;
    if (result.revert) throw result.error;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    else throw result.error;
  }
}

async function rpcOnce(method, params) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        signal: AbortSignal.timeout(12000),
      });
      const json = await res.json();
      if (json.error) {
        const err = new Error(json.error.message || "rpc error");
        err.rpcError = json.error;
        throw err;
      }
      return { ok: true, value: json.result };
    } catch (e) {
      lastErr = e;
      // A contract revert is a definitive answer, not a transport failure.
      // Rate limits (-32005 / 429) and network errors fall through to the
      // next endpoint, and then to rpc()'s retry pass.
      const msg = String(e.rpcError?.message || e.message || "");
      const code = e.rpcError?.code;
      if (code === 3 || /execution reverted|revert/i.test(msg)) {
        return { ok: false, revert: true, error: e };
      }
    }
  }
  return { ok: false, revert: false, error: lastErr };
}

export const SELECTORS = {
  balanceOf: "0x70a08231", // balanceOf(address)
  allowance: "0xdd62ed3e", // allowance(address,address)
  ownerOf: "0x6352211e", // ownerOf(uint256)
  handleOf: "0xc50a1514", // handleOf(address) on the Agent ID registry
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
};

export function encAddress(addr) {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

export function encUint(v) {
  return BigInt(v).toString(16).padStart(64, "0");
}

export async function ethCall(to, data, from) {
  const tx = { to, data };
  if (from) tx.from = from;
  return rpc("eth_call", [tx, "latest"]);
}

export async function getCode(address) {
  return rpc("eth_getCode", [address, "latest"]);
}

export function decodeAddress(hex) {
  if (!hex || hex === "0x") return null;
  return "0x" + hex.slice(-40);
}

export function decodeUint(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

export function decodeString(hex) {
  if (!hex || hex === "0x" || hex.length < 130) return "";
  const body = hex.slice(2);
  const offset = Number(BigInt("0x" + body.slice(0, 64)));
  const lenPos = offset * 2;
  const len = Number(BigInt("0x" + body.slice(lenPos, lenPos + 64)));
  const data = body.slice(lenPos + 64, lenPos + 64 + len * 2);
  return Buffer.from(data, "hex").toString("utf8");
}

export const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";

export async function agentIdOf(address) {
  const [handleRes, balanceRes] = await Promise.allSettled([
    ethCall(AGENT_ID_REGISTRY, SELECTORS.handleOf + encAddress(address)),
    ethCall(AGENT_ID_REGISTRY, SELECTORS.balanceOf + encAddress(address)),
  ]);
  const handle =
    handleRes.status === "fulfilled" ? decodeString(handleRes.value) : "";
  const balance =
    balanceRes.status === "fulfilled" ? decodeUint(balanceRes.value) : 0n;
  return { handle: handle || null, balance: Number(balance), hasAgentId: balance > 0n };
}
