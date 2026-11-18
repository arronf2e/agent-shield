// Pure scoring rules for AgentShield reports.
// A reason is { level: "block" | "warn" | "info", code, message }.
// Verdict mapping: any block reason -> BLOCK; score >= 75 -> ALLOW;
// 45..74 -> WARN; below 45 -> BLOCK.
export function verdictFrom(score, reasons) {
  if (reasons.some((r) => r.level === "block")) return "BLOCK";
  if (score >= 75) return "ALLOW";
  if (score >= 45) return "WARN";
  return "BLOCK";
}

const is1 = (v) => v === "1" || v === 1 || v === true;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/// Score a token contract from its GoPlus token_security record.
export function scoreTokenSecurity(t) {
  const reasons = [];
  let score = 100;
  const deduct = (pts, level, code, message) => {
    score -= pts;
    reasons.push({ level, code, message });
  };

  if (is1(t.is_honeypot)) {
    deduct(100, "block", "HONEYPOT", "貔貅：买入后无法卖出（GoPlus 标记 is_honeypot）");
  }
  if (is1(t.cannot_sell_all)) {
    deduct(60, "block", "CANNOT_SELL_ALL", "无法一次性卖出全部持仓（cannot_sell_all）");
  }
  if (is1(t.owner_change_balance)) {
    deduct(60, "block", "OWNER_CHANGE_BALANCE", "合约所有者可以任意修改用户余额");
  }
  if (is1(t.selfdestruct)) {
    deduct(60, "block", "SELFDESTRUCT", "合约包含 selfdestruct，可被销毁");
  }
  if (is1(t.is_open_source)) {
    reasons.push({ level: "info", code: "OPEN_SOURCE", message: "合约已开源" });
  } else {
    deduct(25, "warn", "NOT_OPEN_SOURCE", "合约未开源，无法审计代码");
  }
  if (is1(t.is_mintable)) {
    deduct(15, "warn", "MINTABLE", "合约可增发，供应量可被稀释");
  }
  if (is1(t.can_take_back_ownership)) {
    deduct(15, "warn", "TAKE_BACK_OWNERSHIP", "所有权可被收回（can_take_back_ownership）");
  }
  if (is1(t.hidden_owner)) {
    deduct(15, "warn", "HIDDEN_OWNER", "存在隐藏所有者");
  }
  if (is1(t.transfer_pausable)) {
    deduct(10, "warn", "TRANSFER_PAUSABLE", "转账可被暂停");
  }
  if (is1(t.is_proxy)) {
    deduct(5, "warn", "PROXY", "代理合约，逻辑可被升级替换");
  }
  if (is1(t.is_blacklisted)) {
    deduct(5, "warn", "HAS_BLACKLIST", "合约带黑名单功能，地址可能被冻结");
  }
  const sellTax = num(t.sell_tax);
  const buyTax = num(t.buy_tax);
  if (sellTax >= 0.5 || buyTax >= 0.5) {
    deduct(50, "block", "EXTREME_TAX", `税率异常高：买 ${(buyTax * 100).toFixed(1)}% / 卖 ${(sellTax * 100).toFixed(1)}%`);
  } else if (sellTax > 0.1 || buyTax > 0.1) {
    deduct(20, "warn", "HIGH_TAX", `税率偏高：买 ${(buyTax * 100).toFixed(1)}% / 卖 ${(sellTax * 100).toFixed(1)}%`);
  } else if (sellTax > 0 || buyTax > 0) {
    reasons.push({ level: "info", code: "TAX", message: `交易税：买 ${(buyTax * 100).toFixed(1)}% / 卖 ${(sellTax * 100).toFixed(1)}%` });
  }
  if (t.owner_address && !is1(t.is_true_token) && t.owner_percent && num(t.owner_percent) > 0.5) {
    deduct(10, "warn", "OWNER_CONCENTRATION", "所有者持仓占比过高");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, verdict: verdictFrom(score, reasons), reasons };
}

/// Score a spender contract from its GoPlus approval_security record.
export function scoreSpenderSecurity(s) {
  const reasons = [];
  let score = 100;
  const deduct = (pts, level, code, message) => {
    score -= pts;
    reasons.push({ level, code, message });
  };

  if (!s || !is1(s.is_contract)) {
    return {
      score: 10,
      verdict: "BLOCK",
      reasons: [
        { level: "block", code: "SPENDER_NOT_CONTRACT", message: "授权目标不是合约地址（可能是个人钱包），给它授权等于把资产控制权交给个人" },
      ],
    };
  }
  if (Array.isArray(s.malicious_behavior) && s.malicious_behavior.length > 0) {
    deduct(80, "block", "MALICIOUS_BEHAVIOR", `GoPlus 标记该授权目标有恶意行为：${s.malicious_behavior.map((b) => b.type || b).join(", ")}`);
  }
  if (is1(s.trust_list)) {
    reasons.push({ level: "info", code: "TRUST_LIST", message: `在 GoPlus 信任名单内${s.tag ? `（${s.tag}）` : ""}` });
  }
  if (is1(s.doubt_list)) {
    deduct(40, "warn", "DOUBT_LIST", "在 GoPlus 存疑名单内");
  }
  if (!is1(s.is_open_source)) {
    deduct(20, "warn", "SPENDER_NOT_OPEN_SOURCE", "授权目标合约未开源");
  }
  const scan = s.contract_scan || {};
  if (is1(scan.approval_abuse)) deduct(40, "block", "APPROVAL_ABUSE", "合约扫描发现授权滥用风险");
  if (is1(scan.privilege_withdraw)) deduct(20, "warn", "PRIVILEGE_WITHDRAW", "合约存在特权提现路径");
  if (is1(scan.blacklist)) deduct(5, "warn", "SPENDER_BLACKLIST", "授权目标带黑名单功能");

  score = Math.max(0, Math.min(100, score));
  return { score, verdict: verdictFrom(score, reasons), reasons };
}

/// Score a plain address from its GoPlus address_security record.
export function scoreAddressSecurity(a) {
  const reasons = [];
  let score = 100;
  const flags = [
    ["phishing_activities", "钓鱼活动"],
    ["cybercrime", "网络犯罪关联"],
    ["money_laundering", "洗钱关联"],
    ["financial_crime", "金融犯罪关联"],
    ["darkweb_transactions", "暗网交易"],
    ["gas_abuse", "Gas 滥用"],
    ["fake_kyc", "假 KYC"],
  ];
  for (const [field, label] of flags) {
    if (is1(a?.[field])) {
      score -= 50;
      reasons.push({ level: "block", code: field.toUpperCase(), message: `地址被标记：${label}` });
    }
  }
  if (is1(a?.contract_address)) {
    reasons.push({ level: "info", code: "IS_CONTRACT", message: "该地址是合约" });
  }
  score = Math.max(0, Math.min(100, score));
  return { score, verdict: verdictFrom(score, reasons), reasons };
}
