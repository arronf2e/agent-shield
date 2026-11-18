---
name: agent-shield
description: |
  Pre-flight security check for AI agents on BNB Chain. Use BEFORE any
  Binance Agentic Wallet (baw) contract-call execute, sign-message execute,
  swap, or token approval: ask AgentShield whether the target contract is
  safe, whether a spender is trustworthy, and whether a prepared transaction
  does what it claims. Returns a machine-readable verdict: ALLOW, WARN or
  BLOCK. On BLOCK, the agent MUST NOT execute.
metadata:
  author: agentshield
  version: "0.1.0"
---

# AgentShield — pre-flight security firewall for agents

An autonomous agent cannot eyeball a preview the way a human can. AgentShield
is the check an agent runs **between preview and execute**:

```
baw contract-call preview  ->  AgentShield tx-check  ->  baw contract-call execute
                               (BLOCK = refuse)
```

## API

Base URL: the AgentShield deployment, e.g. `https://<deployment>` (local dev:
`http://localhost:8787`).

### 1. Check a contract before interacting with it

```
GET /api/guard/check?target=0x<contract>
```

Response (excerpt):

```json
{
  "verdict": "BLOCK",
  "score": 12,
  "reasons": [{ "level": "block", "code": "HONEYPOT", "message": "..." }],
  "reportHash": "0x..."
}
```

### 2. Check a spender before approving it

```
GET /api/guard/approvals?wallet=0x<agent wallet>&spender=0x<spender>&token=0x<token>
```

Without `spender`, returns a sweep of the wallet's existing allowances for
major BSC tokens x major DEX routers, read directly on-chain.

### 3. Pre-flight a prepared transaction

```
POST /api/guard/tx-check
{ "from": "0x<agent wallet>", "to": "0x<contract>", "value": "0", "data": "0x..." }
```

Decodes the call (approve / setApprovalForAll / permit / transfer / ...),
checks the destination contract, checks the spender of any approval, and
simulates execution with `eth_call`.

## Agent rules

1. **BLOCK means do not execute.** Report the reasons to the user and stop.
2. **WARN means pause.** Surface the reasons and ask the user to confirm
   before executing.
3. **ALLOW means proceed** with the normal baw flow (preview already shown,
   user confirmation still required by the baw skill's own rules).
4. If the API is unreachable, treat the check as failed: tell the user and
   require explicit acknowledgement before executing anything (fail closed).
5. After a check, the `reportHash` can be anchored on-chain with
   `GuardRegistry.recordCheck(target, verdict, reportHash)` by a wallet that
   holds a Binance Agent ID. Verdict encoding: ALLOW=0, WARN=1, BLOCK=2.

## Notes

- Read-only: AgentShield never signs, approves, or moves funds.
- Data sources: GoPlus Security, Sourcify, BSC public RPC. A report states
  which sources were available; unavailable sources are never fabricated.
