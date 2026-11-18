// GuardRegistry reader: aggregates the community blocklist and the agent
// leaderboard purely from on-chain data (view calls + event logs), so the
// numbers can always be re-verified against the contract itself.
//
// Configuration (env):
//   GUARD_REGISTRY_ADDRESS  deployed GuardRegistry address (unset = not deployed)
//   GUARD_RPC_URL           RPC endpoint for registry reads
//                           (default: BSC public RPC; the local fork demo
//                           points this at the fork node)
//   GUARD_FROM_BLOCK        first block to scan for events (default 0)
const REGISTRY = (process.env.GUARD_REGISTRY_ADDRESS || "").toLowerCase();
const RPC_URL =
  process.env.GUARD_RPC_URL || "https://bsc-dataseed.binance.org";
const FROM_BLOCK = Number(process.env.GUARD_FROM_BLOCK || 0);

const TOPICS = {
  AgentRegistered: "0x77284e1a75d149ef26161b755b08a0af1ea0723010e19e79bce5626d693581f8",
  CheckRecorded: "0x880c34635af7869b32ce031baae8dcb80becdcfc3b2a4c799f41cb5f2dd1135b",
  RiskReported: "0x69d0c6edb6884294e0bbe11204fa5846191f92ef2bbbaec0e8a919647e90c0ca",
  ReportConfirmed: "0x910132c6f3e7ced3dc35bf08cd7cf39a285b23c245826c132825515e18214c57",
  TargetBlocked: "0xa0c94a88a8bb1eb88d14df1b138bfd81fb64720f85b25e109e592e60fda5a880",
};
const SEL = {
  agentCount: "0xb7dc1284",
  totalChecks: "0x162e2264",
  totalReports: "0xb00eba4f",
  isBlocked: "0xfbac3951",
};

let nextId = 1;
async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result;
}

const topicAddress = (topic) => "0x" + topic.slice(-40);
const topicUint = (topic) => BigInt(topic);
function dataWords(data) {
  const body = (data || "0x").slice(2);
  const words = [];
  for (let i = 0; i + 64 <= body.length; i += 64) words.push(body.slice(i, i + 64));
  return words;
}
function decodeStringData(data) {
  const words = dataWords(data);
  if (words.length < 2) return "";
  const len = Number(BigInt("0x" + words[1]));
  const bytes = (data.slice(2).slice(128, 128 + len * 2) || "");
  return Buffer.from(bytes, "hex").toString("utf8");
}

async function getLogs(topic) {
  return rpc("eth_getLogs", [
    {
      address: REGISTRY,
      fromBlock: "0x" + FROM_BLOCK.toString(16),
      toBlock: "latest",
      topics: [topic],
    },
  ]);
}

async function callUint(selector, args = "") {
  const res = await rpc("eth_call", [{ to: REGISTRY, data: selector + args }, "latest"]);
  return Number(BigInt(res));
}

export function registryConfigured() {
  return /^0x[0-9a-f]{40}$/.test(REGISTRY);
}

async function loadEvents() {
  const [registered, checks, reported, confirmed, blocked] = await Promise.all([
    getLogs(TOPICS.AgentRegistered),
    getLogs(TOPICS.CheckRecorded),
    getLogs(TOPICS.RiskReported),
    getLogs(TOPICS.ReportConfirmed),
    getLogs(TOPICS.TargetBlocked),
  ]);
  return { registered, checks, reported, confirmed, blocked };
}

function aggregate(events) {
  const agents = new Map();
  const agentOf = (addr) => {
    if (!agents.has(addr)) {
      agents.set(addr, { address: addr, handle: null, checks: 0, reports: 0, blockedReports: 0 });
    }
    return agents.get(addr);
  };
  for (const log of events.registered) {
    const a = agentOf(topicAddress(log.topics[1]));
    a.handle = decodeStringData(log.data);
  }
  for (const log of events.checks) {
    agentOf(topicAddress(log.topics[1])).checks += 1;
  }
  const reports = new Map();
  for (const log of events.reported) {
    const id = Number(topicUint(log.topics[1]));
    const reporter = topicAddress(log.topics[2]);
    const target = topicAddress(log.topics[3]);
    const reasonHash = "0x" + (dataWords(log.data)[0] || "");
    reports.set(id, { id, reporter, target, reasonHash, confirms: 1, blocked: false, blockNumber: Number(BigInt(log.blockNumber)) });
    agentOf(reporter).reports += 1;
  }
  for (const log of events.confirmed) {
    const id = Number(topicUint(log.topics[1]));
    const r = reports.get(id);
    if (r) {
      const total = Number(BigInt("0x" + (dataWords(log.data)[0] || "0")));
      if (total > r.confirms) r.confirms = total;
    }
  }
  const blockedTargets = [];
  for (const log of events.blocked) {
    const target = topicAddress(log.topics[1]);
    const reportId = Number(topicUint(log.topics[2]));
    const r = reports.get(reportId);
    if (r) {
      r.blocked = true;
      const reporter = agents.get(r.reporter);
      if (reporter) reporter.blockedReports += 1;
    }
    blockedTargets.push({ target, reportId, blockNumber: Number(BigInt(log.blockNumber)) });
  }
  return { agents, reports, blockedTargets };
}

export async function getBlocklist() {
  if (!registryConfigured()) return { deployed: false, registry: null, reports: [], blockedTargets: [] };
  const events = await loadEvents();
  const { reports, blockedTargets } = aggregate(events);
  return {
    deployed: true,
    registry: REGISTRY,
    rpc: RPC_URL.includes("localhost") || RPC_URL.includes("127.0.0.1") ? "local-fork" : "bsc",
    reports: [...reports.values()].sort((a, b) => b.id - a.id),
    blockedTargets,
  };
}

export async function getLeaderboard() {
  if (!registryConfigured()) {
    return { deployed: false, registry: null, stats: null, agents: [] };
  }
  const events = await loadEvents();
  const { agents, reports, blockedTargets } = aggregate(events);
  const [agentCount, totalChecks, totalReports] = await Promise.all([
    callUint(SEL.agentCount).catch(() => agents.size),
    callUint(SEL.totalChecks).catch(() => events.checks.length),
    callUint(SEL.totalReports).catch(() => reports.size),
  ]);
  const list = [...agents.values()].sort(
    (a, b) => b.checks - a.checks || b.reports - a.reports
  );
  return {
    deployed: true,
    registry: REGISTRY,
    rpc: RPC_URL.includes("localhost") || RPC_URL.includes("127.0.0.1") ? "local-fork" : "bsc",
    stats: {
      agentCount,
      totalChecks,
      totalReports,
      blockedCount: blockedTargets.length,
      goalAgents: 30,
      goalProgress: Math.min(100, Math.round((agentCount / 30) * 100)),
    },
    agents: list,
  };
}
