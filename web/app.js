// AgentShield frontend — talks only to the AgentShield API in api/server.mjs.
const $ = (id) => document.getElementById(id);

let identityAddress = "";

// ------------------------------------------------------------- identity
async function loadIdentity(address) {
  const badge = $("agentBadge");
  if (!address) {
    badge.classList.add("hidden");
    return;
  }
  identityAddress = address;
  badge.classList.remove("hidden", "none");
  badge.textContent = "查询 Agent ID 中...";
  try {
    const r = await fetch(`/api/guard/agent?address=${address}`);
    const j = await r.json();
    if (j.hasAgentId) {
      badge.textContent = `Agent ID：${j.handle}.ai ✓`;
      badge.classList.remove("none");
    } else {
      badge.textContent = "该钱包没有 Agent ID（只读检查可用，上链存证需先注册 .ai）";
      badge.classList.add("none");
    }
  } catch {
    badge.textContent = "Agent ID 查询失败";
    badge.classList.add("none");
  }
  const aw = $("approvalWallet");
  if (aw && !aw.value) aw.value = address;
  const tf = $("txFrom");
  if (tf && !tf.value) tf.value = address;
}

$("walletInput").addEventListener("change", (e) => {
  const v = e.target.value.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) loadIdentity(v);
});

$("connectBtn").addEventListener("click", async () => {
  if (!window.ethereum) {
    alert("没检测到钱包扩展。可以直接在输入框粘贴地址，效果一样。");
    return;
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (accounts && accounts[0]) {
    $("walletInput").value = accounts[0];
    loadIdentity(accounts[0]);
  }
});

// ----------------------------------------------------------------- tabs
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "blocklist") loadBlocklist();
    if (btn.dataset.tab === "leaderboard") loadLeaderboard();
  });
});

// ------------------------------------------------------- blocklist page
const short = (a) => (a ? a.slice(0, 8) + "…" + a.slice(-6) : "-");

async function loadBlocklist() {
  const box = $("blocklistContent");
  box.innerHTML = `<div class="loading">正在从链上事件加载...</div>`;
  try {
    const j = await (await fetch("/api/guard/blocklist")).json();
    if (!j.deployed) {
      box.innerHTML = `<div class="demo-note">GuardRegistry 尚未部署，黑名单暂无数据。合约部署后，社区举报会自动出现在这里。</div>`;
      return;
    }
    const note =
      j.rpc === "local-fork"
        ? `<div class="demo-note">当前为本地主网分叉演示数据（真实 Agent ID 持有者在分叉上模拟操作），主网部署后切换为真实数据。合约：<span class="mono">${escapeHtml(j.registry)}</span></div>`
        : "";
    const blockedRows = (j.blockedTargets || [])
      .map(
        (b) =>
          `<tr><td class="addr">${escapeHtml(b.target)}</td><td>#${b.reportId}</td><td><span class="pill blocked">已拦截</span></td></tr>`
      )
      .join("");
    const reportRows = (j.reports || [])
      .map(
        (r) =>
          `<tr><td>#${r.id}</td><td class="addr">${escapeHtml(r.target)}</td><td class="addr">${short(r.reporter)}</td><td>${r.confirms} / 3</td><td>${
            r.blocked ? `<span class="pill blocked">已拦截</span>` : `<span class="pill pending">待确认</span>`
          }</td></tr>`
      )
      .join("");
    box.innerHTML = `
      ${note}
      <h3 style="margin:14px 0 4px">已拦截目标（${(j.blockedTargets || []).length}）</h3>
      <table><tr><th>合约地址</th><th>举报编号</th><th>状态</th></tr>${blockedRows || `<tr><td colspan="3" class="meta">暂无</td></tr>`}</table>
      <h3 style="margin:20px 0 4px">全部举报</h3>
      <table><tr><th>编号</th><th>目标合约</th><th>举报人</th><th>确认数</th><th>状态</th></tr>${reportRows || `<tr><td colspan="5" class="meta">暂无举报</td></tr>`}</table>`;
  } catch (e) {
    box.innerHTML = `<div class="error">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

// ----------------------------------------------------- leaderboard page
async function loadLeaderboard() {
  const box = $("leaderboardContent");
  box.innerHTML = `<div class="loading">正在从链上事件加载...</div>`;
  try {
    const j = await (await fetch("/api/guard/leaderboard")).json();
    if (!j.deployed) {
      box.innerHTML = `<div class="demo-note">GuardRegistry 尚未部署，排行榜暂无数据。</div>`;
      return;
    }
    const s = j.stats;
    const note =
      j.rpc === "local-fork"
        ? `<div class="demo-note">当前为本地主网分叉演示数据，主网部署后切换为真实数据。合约：<span class="mono">${escapeHtml(j.registry)}</span></div>`
        : "";
    const rows = (j.agents || [])
      .map(
        (a, i) =>
          `<tr><td>${i + 1}</td><td>${a.handle ? escapeHtml(a.handle) + ".ai" : "-"}</td><td class="addr">${escapeHtml(a.address)}</td><td>${a.checks}</td><td>${a.reports}</td></tr>`
      )
      .join("");
    box.innerHTML = `
      ${note}
      <div class="stats">
        <div class="stat"><div class="num">${s.agentCount}</div><div class="lbl">已注册 Agent</div></div>
        <div class="stat"><div class="num">${s.totalChecks}</div><div class="lbl">链上存证检查</div></div>
        <div class="stat"><div class="num">${s.totalReports}</div><div class="lbl">社区举报</div></div>
        <div class="stat"><div class="num">${s.blockedCount}</div><div class="lbl">已拦截目标</div></div>
      </div>
      <div class="meta">黑客松门槛进度：${s.agentCount} / ${s.goalAgents} 个 Agent ID</div>
      <div class="progress"><div style="width:${s.goalProgress}%"></div></div>
      <table><tr><th>#</th><th>Agent ID</th><th>钱包</th><th>检查存证</th><th>举报</th></tr>${rows || `<tr><td colspan="5" class="meta">暂无</td></tr>`}</table>`;
  } catch (e) {
    box.innerHTML = `<div class="error">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

// -------------------------------------------------------------- rendering
const VERDICT_LABEL = { ALLOW: "✅ ALLOW · 可以签", WARN: "⚠️ WARN · 谨慎", BLOCK: "⛔ BLOCK · 不要签" };

function renderReport(container, report, extraHtml = "") {
  const reasons = (report.reasons || [])
    .map((r) => `<li class="${r.level}">${escapeHtml(r.message)}</li>`)
    .join("");
  container.innerHTML = `
    <div class="result">
      <span class="verdict ${report.verdict}">${VERDICT_LABEL[report.verdict] || report.verdict}</span>
      <span class="score">${report.score}<small style="font-size:14px;color:var(--dim)"> / 100</small></span>
      ${extraHtml}
      <ul class="reasons">${reasons}</ul>
      <div class="meta">
        报告哈希（可上链存证）：${report.reportHash || "-"}<br/>
        数据源：${escapeHtml(JSON.stringify(report.sources || {}))} · 检查时间：${escapeHtml(report.checkedAt || "")}
      </div>
      <details><summary>查看原始报告 JSON</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setBusy(container, on) {
  container.innerHTML = on ? `<div class="loading">检查中，正在实时查询链上与安全数据源...</div>` : "";
}
function setError(container, msg) {
  container.innerHTML = `<div class="error">出错了：${escapeHtml(msg)}</div>`;
}

// --------------------------------------------------------- contract check
async function runContractCheck() {
  const target = $("contractInput").value.trim();
  const box = $("contractResult");
  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) return setError(box, "请填一个合法的合约地址");
  setBusy(box, true);
  try {
    const r = await fetch(`/api/guard/check?target=${target}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    const title = j.tokenSymbol
      ? `<div class="meta" style="margin-top:8px">${escapeHtml(j.tokenName || "")}（${escapeHtml(j.tokenSymbol)}）</div>`
      : "";
    renderReport(box, j, title);
  } catch (e) {
    setError(box, e.message);
  }
}
$("contractBtn").addEventListener("click", runContractCheck);
document.querySelectorAll("[data-sample-contract]").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    $("contractInput").value = a.dataset.sampleContract;
    runContractCheck();
  });
});

// --------------------------------------------------------- approval check
$("approvalBtn").addEventListener("click", async () => {
  const wallet = ($("approvalWallet").value.trim() || identityAddress).trim();
  const spender = $("approvalSpender").value.trim();
  const token = $("approvalToken").value.trim();
  const box = $("approvalResult");
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return setError(box, "请先填钱包地址（或在顶部设置身份地址）");
  setBusy(box, true);
  try {
    const qs = new URLSearchParams({ wallet });
    if (spender) qs.set("spender", spender);
    if (token) qs.set("token", token);
    const r = await fetch(`/api/guard/approvals?${qs}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    let extra = "";
    if (j.scope) extra = `<div class="meta" style="margin-top:8px">${escapeHtml(j.scope)}</div>`;
    if (Array.isArray(j.findings) && j.findings.length) {
      extra += `<div class="meta" style="margin-top:6px">发现 ${j.findings.length} 条现有授权，明细见原始报告。</div>`;
    }
    renderReport(box, j, extra);
  } catch (e) {
    setError(box, e.message);
  }
});

// --------------------------------------------------------------- tx check
async function runTxCheck() {
  const body = {
    from: $("txFrom").value.trim() || undefined,
    to: $("txTo").value.trim(),
    value: $("txValue").value.trim() || "0",
    data: $("txData").value.trim() || "0x",
  };
  const box = $("txResult");
  if (!/^0x[0-9a-fA-F]{40}$/.test(body.to)) return setError(box, "请填合法的 to 地址");
  setBusy(box, true);
  try {
    const r = await fetch("/api/guard/tx-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    let extra = "";
    if (j.decoded) {
      extra = `<div class="meta" style="margin-top:8px">解码：${escapeHtml(j.decoded.function || "未知函数 " + j.decoded.selector)}${j.simulation ? ` · 模拟执行：${j.simulation.ok ? "成功" : "revert"}` : ""}</div>`;
    }
    renderReport(box, j, extra);
  } catch (e) {
    setError(box, e.message);
  }
}
$("txBtn").addEventListener("click", runTxCheck);

function padAddr(a) {
  return a.toLowerCase().replace("0x", "").padStart(64, "0");
}
function padUint(v) {
  return v.toString(16).padStart(64, "0");
}
const UNKNOWN_SPENDER = "0x000000000000000000000000000000000000bEEF";
const MAX_UINT = (1n << 256n) - 1n;

$("sampleApprove").addEventListener("click", (e) => {
  e.preventDefault();
  $("txTo").value = "0x55d398326f99059fF775485246999027B3197955"; // USDT
  $("txValue").value = "0";
  $("txData").value = "0x095ea7b3" + padAddr(UNKNOWN_SPENDER) + padUint(MAX_UINT);
  if (!$("txFrom").value && identityAddress) $("txFrom").value = identityAddress;
  runTxCheck();
});
$("sampleRevoke").addEventListener("click", (e) => {
  e.preventDefault();
  $("txTo").value = "0x55d398326f99059fF775485246999027B3197955";
  $("txValue").value = "0";
  $("txData").value = "0x095ea7b3" + padAddr(UNKNOWN_SPENDER) + padUint(0n);
  if (!$("txFrom").value && identityAddress) $("txFrom").value = identityAddress;
  runTxCheck();
});
