// AgentShield check engine: contract check, approval check, tx pre-flight.
// BSC only (chainId 56) for the hackathon MVP.
import { ethCall, getCode, encAddress, encUint, decodeUint, SELECTORS } from "./rpc.mjs";
import {
  goplusTokenSecurity,
  goplusApprovalSecurity,
  goplusAddressSecurity,
  sourcifyVerified,
} from "./sources.mjs";
import { scoreTokenSecurity, scoreSpenderSecurity, scoreAddressSecurity, verdictFrom } from "./scoring.mjs";

export const CHAIN_ID = 56;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (a) => ADDRESS_RE.test(a || "");

function sourceStatus(...entries) {
  const out = {};
  for (const [name, r] of entries) out[name] = r.ok ? "ok" : "unavailable";
  return out;
}

/// ---------------------------------------------------------------- contract
export async function contractCheck(target) {
  if (!isAddress(target)) throw new Error("invalid address");
  target = target.toLowerCase();

  let code;
  try {
    code = await getCode(target);
  } catch {
    // Never fake a NOT_CONTRACT verdict when the chain itself is unreachable.
    return {
      kind: "contract",
      target,
      isContract: null,
      score: 50,
      verdict: "WARN",
      reasons: [
        { level: "warn", code: "RPC_UNAVAILABLE", message: "BSC RPC 暂不可用，无法确认该地址是否有合约代码，请稍后重试" },
      ],
      sources: { chain: "unavailable" },
      checkedAt: new Date().toISOString(),
    };
  }
  const [tokenSec, approvalSec, sourcify] = await Promise.all([
    goplusTokenSecurity(CHAIN_ID, target),
    goplusApprovalSecurity(CHAIN_ID, target),
    sourcifyVerified(CHAIN_ID, target),
  ]);

  const isContract = code && code !== "0x";
  if (!isContract) {
    return {
      kind: "contract",
      target,
      isContract: false,
      score: 0,
      verdict: "BLOCK",
      reasons: [
        { level: "block", code: "NOT_CONTRACT", message: "该地址上没有合约代码（是普通钱包或空地址），不要把它当合约交互" },
      ],
      sources: sourceStatus(["goplus_token", tokenSec], ["sourcify", sourcify]),
      checkedAt: new Date().toISOString(),
    };
  }

  let scored;
  let detail = {};
  if (tokenSec.ok && tokenSec.data) {
    scored = scoreTokenSecurity(tokenSec.data);
    detail = {
      tokenName: tokenSec.data.token_name ?? null,
      tokenSymbol: tokenSec.data.token_symbol ?? null,
      isProxy: tokenSec.data.is_proxy === "1",
    };
  } else if (approvalSec.ok && approvalSec.data) {
    // Non-token contract: fall back to the approval/contract scan view.
    scored = scoreSpenderSecurity(approvalSec.data);
    detail = { contractName: approvalSec.data.contract_name ?? null, tag: approvalSec.data.tag ?? null };
  } else {
    scored = {
      score: 50,
      verdict: "WARN",
      reasons: [
        { level: "warn", code: "SOURCES_UNAVAILABLE", message: "安全数据源暂不可用，仅确认合约存在，结论不完整" },
      ],
    };
  }

  const reasons = [...scored.reasons];
  if (sourcify.ok) {
    if (sourcify.data.match) {
      reasons.push({ level: "info", code: "SOURCIFY_VERIFIED", message: `源码已在 Sourcify 验证（${sourcify.data.match}）` });
    } else {
      reasons.push({ level: "warn", code: "SOURCIFY_UNVERIFIED", message: "源码未在 Sourcify 验证" });
    }
  }

  return {
    kind: "contract",
    target,
    isContract: true,
    ...detail,
    score: scored.score,
    verdict: verdictFrom(scored.score, reasons),
    reasons,
    sources: sourceStatus(
      ["goplus_token", tokenSec],
      ["goplus_approval", approvalSec],
      ["sourcify", sourcify]
    ),
    checkedAt: new Date().toISOString(),
  };
}

/// --------------------------------------------------------------- approvals
// Built-in sweep universe for the wallet approval check (v1 scope, stated
// openly in the report): major BSC tokens x major DEX spenders.
export const SWEEP_TOKENS = [
  { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955" },
  { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
  { symbol: "USD1", address: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d" },
  { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
  { symbol: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" },
  { symbol: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" },
  { symbol: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" },
];
export const SWEEP_SPENDERS = [
  { name: "PancakeSwap V2 Router", address: "0x10ED43C718714eb63d5aA57B78B54704E256024E" },
  { name: "PancakeSwap V3 SmartRouter", address: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4" },
  { name: "PancakeSwap Universal Router", address: "0x32226588343C60c8480f388c4fD47a33A767A76a" },
  { name: "1inch v5 Router", address: "0x1111111254EEB25477B68fb85Ed929f73A960582" },
];

const UNLIMITED = 1n << 255n;

async function allowanceOf(token, owner, spender) {
  const data = SELECTORS.allowance + encAddress(owner) + encAddress(spender);
  const res = await ethCall(token, data);
  return decodeUint(res);
}

export async function approvalCheck({ wallet, spender, token }) {
  if (!isAddress(wallet)) throw new Error("invalid wallet address");
  wallet = wallet.toLowerCase();

  // Mode A: a specific spender the user/agent is about to approve.
  if (spender) {
    if (!isAddress(spender)) throw new Error("invalid spender address");
    spender = spender.toLowerCase();
    const [approvalSec, addressSec] = await Promise.all([
      goplusApprovalSecurity(CHAIN_ID, spender),
      goplusAddressSecurity(CHAIN_ID, spender),
    ]);
    const reasons = [];
    let score = 100;
    if (approvalSec.ok && approvalSec.data) {
      const s = scoreSpenderSecurity(approvalSec.data);
      score = s.score;
      reasons.push(...s.reasons);
    }
    if (addressSec.ok && addressSec.data) {
      const a = scoreAddressSecurity(addressSec.data);
      if (a.reasons.some((r) => r.level === "block")) {
        score = Math.min(score, a.score);
        reasons.push(...a.reasons.filter((r) => r.level === "block"));
      }
    }
    let currentAllowance = null;
    if (token && isAddress(token)) {
      try {
        const v = await allowanceOf(token.toLowerCase(), wallet, spender);
        currentAllowance = v.toString();
        if (v >= UNLIMITED) {
          reasons.push({ level: "warn", code: "EXISTING_UNLIMITED", message: "该钱包已对此目标有无限授权，建议撤销后按需授权" });
          score = Math.min(score, 60);
        } else if (v > 0n) {
          reasons.push({ level: "info", code: "EXISTING_ALLOWANCE", message: `当前已有授权额度：${v.toString()}` });
        }
      } catch {
        /* allowance read is best-effort */
      }
    }
    return {
      kind: "approval-spender",
      wallet,
      spender,
      token: token ?? null,
      currentAllowance,
      score,
      verdict: verdictFrom(score, reasons),
      reasons,
      sources: sourceStatus(["goplus_approval", approvalSec], ["goplus_address", addressSec]),
      checkedAt: new Date().toISOString(),
    };
  }

  // Mode B: sweep of major tokens x major spenders, read straight on-chain.
  const findings = [];
  const jobs = [];
  let readErrors = 0;
  for (const t of SWEEP_TOKENS) {
    for (const s of SWEEP_SPENDERS) {
      jobs.push(
        allowanceOf(t.address, wallet, s.address)
          .then((v) => {
            if (v > 0n) {
              findings.push({
                token: t.symbol,
                tokenAddress: t.address,
                spender: s.name,
                spenderAddress: s.address,
                allowance: v.toString(),
                unlimited: v >= UNLIMITED,
              });
            }
          })
          .catch(() => {
            readErrors += 1;
          })
      );
    }
  }
  // Run with limited concurrency: 28 parallel eth_calls burst past public
  // RPC rate limits and produce false partial reads.
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4));
  }
  const totalReads = SWEEP_TOKENS.length * SWEEP_SPENDERS.length;
  if (readErrors === totalReads) {
    return {
      kind: "approval-sweep",
      wallet,
      scope: "v1 扫描范围：7 个主要代币 x 4 个主要 DEX 授权目标，链上直读 allowance",
      findings: [],
      score: 50,
      verdict: "WARN",
      reasons: [
        { level: "warn", code: "RPC_UNAVAILABLE", message: "BSC RPC 暂不可用，本次扫描没有读到任何链上数据，结论不成立，请稍后重试" },
      ],
      sources: { chain: "unavailable" },
      checkedAt: new Date().toISOString(),
    };
  }

  const reasons = [];
  let score = 100;
  for (const f of findings) {
    if (f.unlimited) {
      reasons.push({
        level: "warn",
        code: "UNLIMITED_ALLOWANCE",
        message: `${f.token} 对 ${f.spender} 是无限授权：该合约一旦出事可转走全部 ${f.token}`,
      });
      score -= 10;
    } else {
      reasons.push({
        level: "info",
        code: "ALLOWANCE_FOUND",
        message: `${f.token} 对 ${f.spender} 有有限授权（${f.allowance}）`,
      });
    }
  }
  if (readErrors > 0) {
    reasons.push({ level: "warn", code: "PARTIAL_READ", message: `本次扫描有 ${readErrors}/${totalReads} 次链上读取失败，结果可能不完整` });
    score -= 5;
  }
  if (findings.length === 0) {
    reasons.push({ level: "info", code: "NO_ALLOWANCES", message: "在主要代币 x 主要 DEX 的扫描范围内没有发现任何授权" });
  }
  score = Math.max(0, score);
  return {
    kind: "approval-sweep",
    wallet,
    scope: "v1 扫描范围：7 个主要代币 x 4 个主要 DEX 授权目标，链上直读 allowance；任意授权目标请用 spender 模式单独检查",
    findings,
    score,
    verdict: verdictFrom(score, reasons),
    reasons,
    sources: { chain: readErrors > 0 ? "partial" : "ok" },
    checkedAt: new Date().toISOString(),
  };
}

/// -------------------------------------------------------------------- tx
const KNOWN_SELECTORS = {
  "0x095ea7b3": { fn: "approve(address,uint256)", kind: "approve" },
  "0x39509351": { fn: "increaseAllowance(address,uint256)", kind: "approve" },
  "0xa22cb465": { fn: "setApprovalForAll(address,bool)", kind: "setApprovalForAll" },
  "0xa9059cbb": { fn: "transfer(address,uint256)", kind: "transfer" },
  "0x23b872dd": { fn: "transferFrom(address,address,uint256)", kind: "transferFrom" },
  "0xd505accf": { fn: "permit(...)", kind: "permit" },
  "0x42842e0e": { fn: "safeTransferFrom(address,address,uint256)", kind: "transfer" },
  "0xa0712d68": { fn: "mint(uint256)", kind: "other" },
  "0x38ed1739": { fn: "swapExactTokensForTokens(...)", kind: "swap" },
  "0x70a08231": { fn: "balanceOf(address)", kind: "view" },
};

function wordAt(data, i) {
  return data.slice(10 + i * 64, 10 + (i + 1) * 64);
}
function addrWord(data, i) {
  const w = wordAt(data, i);
  return w ? "0x" + w.slice(24) : null;
}
function uintWord(data, i) {
  const w = wordAt(data, i);
  return w ? BigInt("0x" + w) : 0n;
}

export async function txCheck({ from, to, value = "0", data = "0x" }) {
  if (!isAddress(to)) throw new Error("invalid 'to' address");
  to = to.toLowerCase();
  const reasons = [];
  let score = 100;
  const deduct = (pts, level, code, message) => {
    score -= pts;
    reasons.push({ level, code, message });
  };

  const selector = (data || "0x").slice(0, 10).toLowerCase();
  const known = KNOWN_SELECTORS[selector];
  const decoded = known
    ? { selector, function: known.fn }
    : { selector, function: null };

  if (!known && data && data.length > 10) {
    deduct(10, "warn", "UNKNOWN_SELECTOR", `未识别的函数选择器 ${selector}，Agent 不应盲签无法解码的交易`);
  }
  if (known?.kind === "view") {
    reasons.push({ level: "info", code: "VIEW_CALL", message: "只读调用，无资产风险" });
  }

  // Approval-specific analysis.
  let spender = null;
  if (known?.kind === "approve") {
    spender = addrWord(data, 0);
    const amount = uintWord(data, 1);
    decoded.spender = spender;
    decoded.amount = amount.toString();
    if (spender) {
      if (amount === 0n) {
        // Revoking an allowance is safe regardless of who the spender is.
        reasons.push({ level: "info", code: "REVOKE", message: "授权额设为 0（撤销授权），安全操作" });
      } else {
        const sec = await goplusApprovalSecurity(CHAIN_ID, spender);
        if (sec.ok && sec.data) {
          const s = scoreSpenderSecurity(sec.data);
          reasons.push(...s.reasons);
          if (amount >= UNLIMITED) {
            if (s.reasons.some((r) => r.code === "TRUST_LIST")) {
              deduct(15, "warn", "UNLIMITED_TO_TRUSTED", "给信任名单内的合约无限授权：常见但仍建议按需授权");
            } else {
              deduct(70, "block", "UNLIMITED_TO_UNVERIFIED", "给未在信任名单的合约无限授权，对方可转走该代币全部余额");
            }
          }
        } else if (amount >= UNLIMITED) {
          deduct(50, "warn", "UNLIMITED_UNCHECKED", "无限授权且授权目标风险数据暂不可用");
        }
      }
    }
  }
  if (known?.kind === "setApprovalForAll") {
    spender = addrWord(data, 0);
    decoded.spender = spender;
    deduct(70, "block", "SET_APPROVAL_FOR_ALL", "setApprovalForAll 会交出全部 NFT 的转移权，除非目标是已验证的交易市场，否则不要签");
  }
  if (known?.kind === "permit") {
    deduct(15, "warn", "PERMIT", "permit 签名授权：离线签名同样能被用来转走代币，确认 spender 与额度");
  }

  // Destination contract risk (reuse the contract check, cached sources).
  const dest = await contractCheck(to).catch(() => null);
  if (dest && dest.isContract === null) {
    reasons.push({ level: "warn", code: "DEST_UNCHECKED", message: "目标合约体检因 RPC 不可用未完成" });
  } else if (dest) {
    if (!dest.isContract && (!data || data === "0x")) {
      reasons.push({ level: "info", code: "PLAIN_TRANSFER", message: "向普通钱包的普通转账" });
    } else if (!dest.isContract) {
      deduct(30, "warn", "TO_NOT_CONTRACT", "目标地址没有合约代码，但交易携带了 calldata/金额");
    } else {
      for (const r of dest.reasons.filter((x) => x.level === "block")) {
        reasons.push({ level: "block", code: "DEST_" + r.code, message: `目标合约风险：${r.message}` });
      }
      if (dest.verdict === "WARN") {
        deduct(15, "warn", "DEST_WARN", "目标合约体检结论为 WARN");
      }
    }
  }

  const valueWei = BigInt(value || "0");
  if (valueWei > 0n && dest && dest.isContract && dest.score < 75) {
    deduct(10, "warn", "VALUE_TO_RISKY", "向风险评分偏低的合约发送 BNB");
  }

  // Simulation (only meaningful with a sender).
  let simulation = null;
  if (from && isAddress(from)) {
    try {
      const res = await ethCall(to, data || "0x", from.toLowerCase());
      simulation = { ok: true, returnData: (res || "0x").slice(0, 66) };
    } catch (e) {
      simulation = { ok: false, error: String(e.rpcError?.message || e.message || e).slice(0, 200) };
      deduct(10, "warn", "SIM_REVERT", "模拟执行会 revert：这笔交易大概率失败白烧 gas，或参数不对");
    }
  } else {
    reasons.push({ level: "info", code: "NO_SIM", message: "未提供 from 地址，跳过模拟执行" });
  }

  score = Math.max(0, Math.min(100, score));
  return {
    kind: "tx",
    from: from ?? null,
    to,
    value: String(value || "0"),
    decoded,
    destContract: dest
      ? { score: dest.score, verdict: dest.verdict, isContract: dest.isContract }
      : null,
    simulation,
    score,
    verdict: verdictFrom(score, reasons),
    reasons,
    checkedAt: new Date().toISOString(),
  };
}
