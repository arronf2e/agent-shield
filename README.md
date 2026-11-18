# AgentShield — a pre-execution firewall for AI agents

> **AI agents can spend money on their own now. AgentShield checks every
> contract, approval and transaction *before* the agent signs — and returns a
> machine-readable verdict: `ALLOW` / `WARN` / `BLOCK`.**

Built for the **Binance Wallet × BNB Chain Agent ID Hackathon** (Nov–Dec 2026).
AgentShield never holds keys, never signs, and never moves funds. It only
answers one question, fast and with evidence: *should this transaction be
signed?*

中文简介：AgentShield 是给 AI Agent 钱包装的「执行前防火墙」。Agent 在币安
Agentic Wallet 里签名之前，先把合约、授权、交易发给 AgentShield 体检，拿到
机器可读的 ALLOW / WARN / BLOCK 结论再决定签不签。检查报告可哈希上链存证，
社区还能共同维护一份链上黑名单。

---

## Why

Agentic wallets let AI agents transact autonomously. That autonomy has a
missing layer: **pre-signing risk control designed for machines**. Humans get
wallet warnings written for humans; agents need a verdict they can parse,
thresholds they can enforce, and an audit trail they can prove. AgentShield
provides exactly that, bound to the agent's on-chain identity (Agent ID /
`.ai` names on BNB Chain).

## What it does

| Capability | Description |
|---|---|
| **Contract check** | Scores any BSC contract from GoPlus security data, Sourcify verification and live on-chain reads (code presence, proxy detection). Honeypot / mintable / hidden-owner style flags lower the score with human-readable reasons. |
| **Approval check** | Two modes: score a single spender (is it even a contract? is it on GoPlus' trust list? any malicious flags?) and sweep a wallet's live allowances across major tokens × major DEX routers, read straight from chain. |
| **Transaction rehearsal** | Decodes pending calldata (`approve`, `setApprovalForAll`, EIP-2612 `permit`, plain transfers), merges destination-contract risk, and dry-runs the exact transaction with `eth_call`. Unlimited approvals to unverified spenders and simulation reverts are hard blocks. |
| **On-chain attestation** | Every report carries a `reportHash`. Registered Agent ID holders can anchor it in `GuardRegistry`, creating a public, verifiable trail of who checked what, and what the verdict was. |
| **Community blocklist** | Any registered agent can report a risky contract. When 3 distinct Agent IDs confirm, the target is blocked on-chain — no admin, no multisig, no off switch. |
| **Leaderboard** | Registrations, attested checks and reports are aggregated purely from contract events, so every number on the page can be re-verified on-chain. |

### Verdict rules

- Any **block-level** reason → `BLOCK`, regardless of score.
- Score ≥ 75 → `ALLOW`; 45–74 → `WARN`; < 45 → `BLOCK`.
- If a data source is unavailable, the report says so explicitly
  (`RPC_UNAVAILABLE`, `PARTIAL_READ`, …). AgentShield never fabricates a
  clean result it could not verify — agents integrating it are told to
  **fail closed**.

## Architecture

```
                ┌────────────────────────────┐
  Agent / dApp ─┤  POST /api/guard/tx-check  ├── verdict + reasons + reportHash
                └─────────────┬──────────────┘
                              │
        ┌─────────────────────▼─────────────────────┐
        │  Check engine (engine/)                   │
        │  GoPlus · Sourcify · BSC RPC (on-chain)   │
        └─────────────────────┬─────────────────────┘
                              │ reportHash anchored by Agent ID holders
        ┌─────────────────────▼─────────────────────┐
        │  GuardRegistry (BSC)                      │
        │  register · recordCheck · reportRisk      │
        │  3-confirm community blocklist            │
        └───────────────────────────────────────────┘
```

- `contracts/GuardRegistry.sol` — identity-gated registry. Registration
  requires actually owning the Agent ID (double-checked against the SPACE ID
  Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`). No owner,
  no admin functions, no withdrawals, no upgrade proxy.
- `engine/` — zero-framework check engine (plain Node.js, `fetch`-based RPC).
- `api/server.mjs` — the HTTP API + static web app.
- `web/` — the human-facing dashboard (contract check, approval check,
  transaction rehearsal, blocklist, leaderboard).
- `SKILL.md` — integration spec for other agents: insert one guard call
  between *preview* and *execute*; refuse to sign on `BLOCK`.

## API

```bash
# Contract check
GET  /api/guard/check?target=0x55d398326f99059fF775485246999027B3197955

# Approval check (spender mode, or wallet sweep when spender is omitted)
GET  /api/guard/approvals?wallet=0x...&spender=0x...&token=0x...

# Transaction rehearsal
POST /api/guard/tx-check
{ "from": "0x...", "to": "0x...", "value": "0", "data": "0x095ea7b3..." }

# Agent ID lookup
GET  /api/guard/agent?address=0x...

# Community blocklist / leaderboard (from GuardRegistry events)
GET  /api/guard/blocklist
GET  /api/guard/leaderboard
```

Example verdict (unlimited approval to a non-contract address):

```json
{
  "kind": "tx",
  "verdict": "BLOCK",
  "score": 30,
  "reasons": [
    { "level": "block", "code": "SPENDER_NOT_CONTRACT", "message": "..." },
    { "level": "block", "code": "UNLIMITED_TO_UNVERIFIED", "message": "..." }
  ],
  "reportHash": "0x…"
}
```

## Verification (all reproduced locally, see `TEST-RESULTS.md`)

- **13/13 unit tests** pass for `GuardRegistry` (registration spoofing,
  duplicate registration, attestation counting, 3-confirm block threshold…).
- **Mainnet-fork test** against the real Agent ID registry: a simulated
  `shuyue.ai` holder registers and attests successfully; a non-holder is
  rejected.
- **11/11 end-to-end engine cases** against real BSC addresses: USDT scores
  ALLOW 85, a plain wallet address scores BLOCK 0 as a "contract", unlimited
  approval to an unknown address is BLOCK 30, an approval revocation is
  ALLOW 100, `setApprovalForAll` is BLOCK 20, and more.
- **Fork demo of blocklist/leaderboard**: GuardRegistry deployed on a local
  BSC mainnet fork; five real Agent ID holders (impersonated on the fork
  only) registered, attested 6 checks and filed 2 reports — one target
  reached 3 confirmations and was blocked. The API output matched the seeded
  chain state exactly.

## Run it locally

```bash
npm install

# Contract tests
npx hardhat test

# Mainnet-fork verification of the registry wiring
BSC_FORK=1 npx hardhat test test/fork-verify.js   # see hardhat.config.js

# API + web dashboard on http://localhost:8787
node api/server.mjs

# Engine smoke test (server must be running)
node scripts/smoke-engine.mjs
```

Optional env for the blocklist/leaderboard pages: `GUARD_REGISTRY_ADDRESS`,
`GUARD_RPC_URL`, `GUARD_FROM_BLOCK`. Without them the two pages report
"not deployed yet" instead of inventing data.

## Status & roadmap

- ✅ Check engine, API, dashboard, contract, tests — done and verified.
- ⏳ GuardRegistry mainnet deployment — scheduled during the hackathon
  submission window; the dashboard switches from fork-demo data to live
  data by configuration only.
- 🎯 Hackathon goal: ≥ 30 distinct Agent ID addresses interacting with
  GuardRegistry (register + first attested check is one call each).
- Next: allowance-change monitoring for registered agents, NFT approval
  coverage, multi-chain verdicts.

## License

MIT
