# AgentShield 实测记录

## 合约（2026-11-18）
- Hardhat 编译通过（Solidity 0.8.24，2 个合约）
- 单元测试 13/13 全过（注册校验、存证计数、黑名单 3 人确认阈值等）
- BSC 主网分叉验证（publicnode，区块 134,281,265）：GuardRegistry 接真实
  Agent ID 注册表，模拟 shuyue 钱包 register("shuyue") + recordCheck 成功，
  无 ID 钱包注册被正确拦截。全程本地模拟，未花钱、未动用户钱包。

## 检查引擎端到端冒烟（2026-11-18，本地服务，真实 BSC 地址）
脚本：scripts/smoke-engine.mjs

| 用例 | 结果 |
|---|---|
| Agent ID 查询 shuyue 钱包 | handle=shuyue，hasAgentId=true |
| 合约体检 USDT | ALLOW，85 分（开源✓、Sourcify 已验证、可增发 -15） |
| 合约体检 普通钱包地址 | BLOCK，0 分（NOT_CONTRACT） |
| 授权扫描 shuyue 钱包 | ALLOW，95 分，无授权发现；带 PARTIAL_READ 标记（28 次读取中个别失败，已如实标注） |
| Spender 体检 PancakeSwap V2 Router | ALLOW，100 分（信任名单） |
| Spender 体检 普通钱包地址 | BLOCK，10 分（SPENDER_NOT_CONTRACT） |
| 交易预演 无限授权→陌生地址 | BLOCK，30 分（SPENDER_NOT_CONTRACT + UNLIMITED_TO_UNVERIFIED） |
| 交易预演 撤销授权 approve(0) | ALLOW，100 分 |
| 交易预演 无限授权→Pancake Router | ALLOW，85 分（信任名单内，仍提示按需授权） |
| 交易预演 setApprovalForAll | BLOCK，20 分 |
| 交易预演 普通 BNB 转账 | ALLOW，100 分 |

## 实测中发现并已修复的问题
1. publicnode 限流错误（-32005）曾被误判为合约 revert，导致 RPC 回退失效
   → rpc.mjs 区分 revert（ definitive）与限流/网络错误（换节点 + 重试一轮），
   且 dataseed 优先。
2. RPC 不可用时合约体检曾误报 NOT_CONTRACT → 改为明确的 RPC_UNAVAILABLE
   WARN，不编造结论；授权扫描全失败时同理。
3. 授权扫描 28 次并发 eth_call 触发限流 → 改为 4 并发分批，失败如实标
   PARTIAL_READ（仍偶发，为已知问题，报告中明示）。
4. 撤销授权曾被 spender 风险误伤为 BLOCK → amount=0 时跳过 spender 评分。
5. 普通 BNB 转账曾被误报 TO_NOT_CONTRACT → 无 calldata 即普通转账。

## 黑名单页 + 排行榜（2026-11-18 追加）
- 数据层 engine/registry.mjs：纯从 GuardRegistry 的 view 调用 + 事件日志聚合，
  不经任何自建数据库，页面数字可在链上复核。
- 演示数据：在本地 BSC 主网分叉节点（区块 134,285,078）部署 GuardRegistry
  （0x99fBd04BBE2269B0AA348da932937B5e2461e490），模拟 5 位真实 Agent ID
  持有者（shuyue/heyi/binance/bibi/hello，仅分叉 impersonation）完成注册、
  6 次检查存证、2 次举报；BEEF 地址经 3 人确认被拦截，DEAD 地址 1 次确认待定。
- API 实测与种子数据一致性校验 PASS：agentCount=5、totalChecks=6、
  totalReports=2、blockedCount=1、门槛进度 17%（5/30），shuyue 以 2 次检查居榜首。
- 前端两页均明确标注「本地主网分叉演示数据」，主网部署后改 env 即切换真实数据。

## 已知限制（v1 明示范围）
- 授权扫描范围：7 个主要代币 × 4 个主要 DEX；任意 spender 用 spender 模式查。
- 交易预演的模拟执行依赖 from 地址；未提供时明确标注跳过。
- GuardRegistry 尚未部署主网（用户拍板押后），前端的上链存证按钮未开放。
