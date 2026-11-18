// External security data sources. All endpoints below were verified live
// without an API key on 2026-11-18 (free tier, rate-limited per IP):
//   - GoPlus token_security / approval_security / address_security
//   - Sourcify v2 contract verification lookup
// Every source degrades gracefully: on failure it returns { ok:false } and
// the scoring layer marks the source unavailable instead of inventing data.
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

async function fetchJson(url, timeoutMs = 15000) {
  const key = url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const value = await res.json();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function settle(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function goplusTokenSecurity(chainId, address) {
  return settle(async () => {
    const j = await fetchJson(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`
    );
    if (j.code !== 1) throw new Error(j.message || "goplus error");
    return j.result?.[address.toLowerCase()] ?? null;
  });
}

export function goplusApprovalSecurity(chainId, address) {
  return settle(async () => {
    const j = await fetchJson(
      `https://api.gopluslabs.io/api/v1/approval_security/${chainId}?contract_addresses=${address}`
    );
    if (j.code !== 1) throw new Error(j.message || "goplus error");
    return j.result ?? null;
  });
}

export function goplusAddressSecurity(chainId, address) {
  return settle(async () => {
    const j = await fetchJson(
      `https://api.gopluslabs.io/api/v1/address_security/${address}?chain_id=${chainId}`
    );
    if (j.code !== 1) throw new Error(j.message || "goplus error");
    return j.result ?? null;
  });
}

export function sourcifyVerified(chainId, address) {
  return settle(async () => {
    const j = await fetchJson(
      `https://sourcify.dev/server/v2/contract/${chainId}/${address}`
    );
    return { match: j.match ?? null, verifiedAt: j.verifiedAt ?? null };
  });
}
