# AgentShield — Agent ID 安全卫士 · MVP 方案

> 参赛：币安钱包 x BNB Chain Agent ID 黑客松
> 提交期：2026-11-18 16:00 — 2026-12-09 16:00 (CST)
> 目标奖项：Agent 应用创新奖（主攻） + Agent ID 生态领航奖（兼投）
> 参赛身份：shuyue.ai / 钱包 0x6D061974e66f5AF28C703DE5C1Ae33a671ded45F

## 1. 一句话定位

给会自己花钱的 AI Agent 装一道执行前防火墙：
Agent 在用 Binance Agentic Wallet 签名/打新/授权之前，先调 AgentShield 检查
「这个合约安不安全、这笔交易到底在干什么、我的授权有没有裸奔」，
拿到 ALLOW / WARN / BLOCK 的机器可读结论再决定执不执行。

评委版英文：A pre-flight security firewall for autonomous agents on BNB Chain.
Every BAW transaction is checked before it is signed — by agents, for agents.

## 2. 为什么这个题能赢

1. 切中 BAW 的结构性风险：真人会看 preview，Agent 不会。Agent 自动执行
   时一次盲签就能被无限授权 / 貔貅 / 假合约掏空，这是生态规模化前必须补的洞。
2. 对 Anco 的胃口：Anco 是币安安全口。Ptah 社区此前正是靠「别乱扫码登录、
   别乱开开发者模式」的安全建议被币安公开采纳致谢 — 安全议题在这个赛道
   有已被验证的加分先例。
3. 不是又一个展示工具：用户此前做的金卡/查询器被评「纯展示、没法操作」。
   本项目每一步都是真操作：真检查、真模拟、真上链存证、真能被其他 Agent 调用。
4. 双奖通吃：创新奖看深度/实用/完成度/创新；领航奖看生态增长 — 共享黑名单
   和开放 API/Skill 让其他项目接入，天然带增长故事。

## 3. 对着评分表设计（创新奖 100 分制）

| 维度 | 权重 | 我们的得分动作 |
|---|---|---|
| Agent ID 应用深度 | 30% | 不是贴名字：合约层强制校验 Agent ID 注册表 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F 的 ownerOf / handleOf；只有持有 .ai 的钱包能注册、存证、举报；检查报告与 Agent ID 绑定，信誉跟着身份走 |
| 实用性与合理性 | 25% | 三个检查全是打新日常真痛点：假合约、貔貅、无限授权。用 baw 自身的 preview / approvals 语义做对照，结论给「能不能签」而不是一堆原始数据 |
| 产品完成度 | 25% | 上线可用的网页 + 已部署并在 BscScan 开源验证的合约 + 公开 API + SKILL.md + 2 分钟演示视频；评委自己连钱包就能跑完一遍 |
| 创新性 | 20% | 市面安全工具都是给「人」看的仪表盘；我们给「Agent」用的：机器可读 verdict + MCP/Skill 接口，Agent 执行前自动拦截。这是 Agent 经济独有的形态 |

硬门槛（不过不评）：产品上线 + 活动期内 ≥30 个 Agent ID 地址与参赛合约交互。
→ 由 GuardRegistry 的 register() + recordCheck() 承接，见第 5 节拉人打法。

## 4. MVP 功能清单

### P0 — 必须做完（缺一不可提交）

**模块 A：Agent ID 身份层**
- 连接钱包（MetaMask / 币安钱包均可）→ 读注册表 handleOf(address) 显示 .ai 名
- 无 Agent ID 的钱包：只读检查可用，但不能上链存证/举报，页面引导去注册
  （这本身就是给生态导流，领航奖叙事）

**模块 B：三件套检查引擎（核心）**
1. 合约体检 — 输入任意 BSC 合约地址：
   - BscScan：是否已验证源码、是否代理合约、部署时间、创建者
   - GoPlus Token/Contract Security：是否貔貅 (is_honeypot)、能否增发、
     税率、黑名单函数、owner 是否放弃、隐藏 owner 等
   - 输出：0–100 风险分 + 红/黄/绿灯 + 每条风险的人话解释
2. 授权体检 — 输入/连接钱包地址：
   - 扫全部 ERC20 approve：无限授权、授权给未验证合约、长期未用授权置顶标红
   - 每条给「建议撤销」并生成 baw approvals revoke 的现成命令/跳转说明
     （产品内不代签，安全边界干净）
3. 交易预演卫士 — 粘贴一笔待签交易（to / value / data，或 baw preview 的输出）：
   - eth_call 模拟执行是否 revert
   - 解码函数选择器：approve / setApprovalForAll / transfer / mint 等高危动作置顶
   - 无限授权、向全新地址大额转账、陌生选择器 → 直接 BLOCK
   - 输出 verdict：ALLOW / WARN / BLOCK + 理由列表

**模块 C：给 Agent 用的接口（创新点，务必做）**
- REST：GET /api/guard/check?chain=bsc&target=<addr> →
  { "verdict": "BLOCK", "score": 18, "reasons": ["honeypot", "mintable"] }
- 同步发布 SKILL.md：任何支持 Binance Agentic Wallet Skill 的 Agent
  在 contract-call preview 之后、execute 之前插入一步 guard check，
  BLOCK 时拒绝执行。README 里给出接入前后对比示例。

**模块 D：链上注册表合约 GuardRegistry.sol（BSC 主网）**
- register(bytes32 agentNameHash) — 校验 msg.sender == ownerOf(tokenId)，
  tokenId = uint256(keccak256(handle))，与现有工具线已验证的口径一致
- recordCheck(address target, uint8 verdict, bytes32 reportHash) —
  每次检查可一键存证（只存哈希，不存隐私数据），累计个人检查数
- reportRisk(address target, bytes32 reasonHash) + confirmReport(id) —
  社区共享黑名单：举报与确认都要求持有 Agent ID，防乱举报
- 只读：checkCount / reportCount / isBlocked(target) 供前端和 API 查询
- 约束：无管理员提款、无升级代理（或代理权 renounce），源码 BscScan 验证

**模块 E：前端（单站）**
- 首页：输入框三合一（合约 / 钱包 / 交易），示例地址一键填入（含一个已知貔貅样本）
- 我的护盾页：我的 Agent ID、检查历史（链上存证）、我的授权风险汇总
- 黑名单页：社区举报列表 + 确认数 + 被拦截总次数（生态数据，领航奖素材）
- 排行榜：参与存证的 Agent ID 数、总检查数 — 实时展示冲 30 门槛的进度

### P1 — 有时间再做（不挡提交）
- 检查报告生成可分享图片/链接（给内容奖发帖用）
- Telegram 机器人：发合约地址秒回结论
- EIP-712 签名消息检查（sign-message preview 的文本解析）

### 明确不做（防烂尾）
- 不做浏览器插件、不做多链（只 BSC）、不做代用户撤销/代签、不碰私钥、
  不做付费墙、不训练任何「AI 风险模型」— 规则引擎 + 权威数据源足够

## 5. 拉满 30 个 Agent ID 交互的打法（11 月内启动，别拖到最后）

门槛计数口径：活动期内与参赛合约交互过的不同 Agent ID 地址 ≥30。

1. 自有：shuyue.ai 本人完成 register + 首次存证，作为第 1 个和演示样本。
2. 存量池：用户一直在维护 Agent ID 生态监控（已收录 400+ 项目）和狙击手用户群，
   这些全是真实 Agent ID 持有者 — 在生态群/X 发「免费给你的 Agent 做一次
   安全体检，上链留个护盾记录」，转化 30 个真实用户是现实的。
3. 钩子设计：完成首次存证的用户进入黑名单共建名单 + 排行榜露名；
   不发币、不承诺空投（避免违规叙事），卖点就是「查一次你最近打的合约」。
4. 节奏：合约 11 月 25 日前上线主网，11 月 26 日起开始拉人，
   留两周缓冲；每天看排行榜计数，不足时定向邀请生态项目方钱包补位。
5. 红线：不自建小号刷数 — 评委查得到关联，且与安全产品的人设自相矛盾。

## 6. 技术方案

- 合约：Solidity 0.8.24 + Foundry，单合约约 250 行，部署费 < 0.01 BNB
- 前端：Vite + React + viem（不用 wagmi 全家桶，轻量），Vercel 部署
  （沿用已有 agentid-tools 站点的部署通道经验）
- 后端：Vercel Serverless Functions 代理 GoPlus / BscScan（key 只放服务端），
  检查结果缓存 10 分钟防限流；RPC 用 BSC 公共节点 + 备用节点各一
- 数据源：GoPlus Security API（免费层）+ BscScan API + 链上直读注册表
- 仓库：GitHub 公开 + MIT，含 contracts / web / api / SKILL.md / README
  （架构图 + 演示视频链接 + 合约地址 + 验证链接）

待核实（开工第一天先验，别假设）：
- 注册表 ABI：handleOf / ownerOf 的确切签名以 BscScan 已验证源码为准
- GoPlus 免费层对 BSC 合约安全接口的字段与限流
- 黑客松提交表单字段（作品入口表单尚未打开确认过）

## 7. 排期（到 12 月 9 日 16:00 截止，倒排）

| 时间 | 里程碑 |
|---|---|
| 11/19–11/21 | 合约写完 + 测试网部署 + 注册表 ABI 核实 + GoPlus 接口打通 |
| 11/22–11/25 | 三件套检查引擎 + API verdict 接口；合约主网部署 + BscScan 验证 |
| 11/26–11/30 | 前端五页 + SKILL.md；正式上线，开始拉 30 个交互 |
| 12/01–12/04 | 黑名单共建 + 排行榜；修 bug；观察交互数达标 |
| 12/05–12/07 | README/架构图/演示视频（2 分钟：真人打一个貔貅被 BLOCK 全程） |
| 12/08 | 填作品提交表单 + 另发 X 内容帖（带 #BinanceWalletHackathon #AgenticWallet）填内容奖表单，双吃 2,000 USDC 池 |
| 12/09 16:00 | 截止（评审 12/09–12/17，公示 12/17–12/20） |

## 8. 成本与风险

- 成本：部署 gas < 0.01 BNB；Vercel / GoPlus / BscScan 免费层；总现金成本 ≈ 0
- 最大风险 1：模拟执行做深了会吞时间 → MVP 只做 eth_call 成败 + 选择器解码，
  不做全量状态差分，P0 边界已划死
- 最大风险 2：30 交互不达标 → 11/26 就开拉，留两周，不等产品完美
- 最大风险 3：GoPlus 限流/字段变动 → 结论层做降级：单源可用时出分并标注来源，
  绝不编造缺失字段

## 9. 提交清单（12/08 逐项打勾）

- [ ] GuardRegistry 主网地址 + BscScan 开源验证链接
- [ ] 线上站点 URL（评委可直接连钱包体验）
- [ ] GitHub 公开仓库（MIT，提交记录在活动期内）
- [ ] SKILL.md + API 文档
- [ ] 2 分钟演示视频
- [ ] 作品表单已提交；内容帖已发并填内容奖表单
- [ ] 链上数据截图：≥30 个 Agent ID 交互地址数
