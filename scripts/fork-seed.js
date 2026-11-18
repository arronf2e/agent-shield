// Seed a GuardRegistry deployment on a local BSC mainnet fork node
// (npx hardhat node --fork <bsc rpc> --port 8545) with realistic activity:
// five REAL Agent ID holders (impersonated on the fork only — no real funds,
// no real transactions) register, record checks, and drive one target into
// the community blocklist. Writes demo-registry.json for the API server.
//
// Run: npx hardhat run scripts/fork-seed.js --network localhost
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const REAL_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const HOLDERS = [
  { handle: "shuyue", address: "0x6D061974e66f5AF28C703DE5C1Ae33a671ded45F" },
  { handle: "heyi", address: "0x72B73415e263C2b976B2770ee764BACD02ec3004" },
  { handle: "binance", address: "0x5E3fBbc8D260a63C9fe19CbBb0A9d5792C3375eA" },
  { handle: "bibi", address: "0xE9D60ff6C5dd8b6B562916D6ecc86206e15415Ab" },
  { handle: "hello", address: "0x12b95cB63de32D321Cb3DBD532d603Ca3eCfDa08" },
];
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const BEEF = "0x000000000000000000000000000000000000bEEF";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function impersonate(address) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await network.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
  return ethers.getSigner(address);
}

async function main() {
  const Guard = await ethers.getContractFactory("GuardRegistry");
  const guard = await Guard.deploy(REAL_REGISTRY);
  await guard.waitForDeployment();
  const address = await guard.getAddress();
  const deployTx = guard.deploymentTransaction();
  const deployBlock = deployTx ? (await ethers.provider.getTransactionReceipt(deployTx.hash)).blockNumber : 0;
  console.log("GuardRegistry on fork:", address, "at block", deployBlock);

  const signers = {};
  for (const h of HOLDERS) {
    signers[h.handle] = await impersonate(h.address);
    await (await guard.connect(signers[h.handle]).register(h.handle)).wait();
    console.log("registered:", h.handle);
  }

  const checks = [
    ["shuyue", USDT, 0],
    ["shuyue", CAKE, 1],
    ["heyi", USDT, 0],
    ["binance", BEEF, 2],
    ["bibi", USDT, 0],
    ["hello", CAKE, 1],
  ];
  for (const [who, target, verdict] of checks) {
    await (await guard.connect(signers[who]).recordCheck(target, verdict, hash(`check:${who}:${target}:${verdict}`))).wait();
  }
  console.log("recorded checks:", checks.length);

  // Report 0: shuyue reports BEEF; heyi + binance confirm -> blocked at 3.
  await (await guard.connect(signers.shuyue).reportRisk(BEEF, hash("suspected honeypot: buyers cannot sell"))).wait();
  await (await guard.connect(signers.heyi).confirmReport(0)).wait();
  await (await guard.connect(signers.binance).confirmReport(0)).wait();
  console.log("report 0 confirmed x3, isBlocked(BEEF):", await guard.isBlocked(BEEF));

  // Report 1: heyi reports DEAD; nobody confirms yet -> stays pending.
  await (await guard.connect(signers.heyi).reportRisk(DEAD, hash("phishing clone of a legit dApp"))).wait();
  console.log("report 1 pending, isBlocked(DEAD):", await guard.isBlocked(DEAD));

  console.log("agentCount:", (await guard.agentCount()).toString(), "totalChecks:", (await guard.totalChecks()).toString(), "totalReports:", (await guard.totalReports()).toString());

  const out = {
    guardRegistry: address,
    fromBlock: deployBlock,
    rpc: "http://127.0.0.1:8545",
    note: "Local BSC mainnet fork demo data. Impersonated real Agent ID holders on the fork only; no real funds or mainnet transactions.",
  };
  fs.writeFileSync(path.join(__dirname, "..", "demo-registry.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("wrote demo-registry.json");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
