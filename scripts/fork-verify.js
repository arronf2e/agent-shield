// Local mainnet-fork verification (no real funds, no real transactions).
// Deploys GuardRegistry wired to the REAL Agent ID registry on a local fork
// of BSC mainnet, then impersonates the shuyue.ai wallet to run the full
// register -> recordCheck flow against real on-chain registry state.
//
// Run: BSC_FORK=1 npx hardhat run scripts/fork-verify.js --network hardhat
const { ethers, network } = require("hardhat");

const REAL_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const SHUYUE_WALLET = "0x6D061974e66f5AF28C703DE5C1Ae33a671ded45F";
const TARGET = "0x000000000000000000000000000000000000bEEF";

async function main() {
  console.log("network:", network.name, "(fork of BSC mainnet)");

  const Guard = await ethers.getContractFactory("GuardRegistry");
  const guard = await Guard.deploy(REAL_REGISTRY);
  await guard.waitForDeployment();
  console.log("GuardRegistry (fork):", await guard.getAddress());

  // Impersonate the real shuyue.ai holder on the fork only.
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [SHUYUE_WALLET],
  });
  await network.provider.send("hardhat_setBalance", [
    SHUYUE_WALLET,
    "0x56BC75E2D63100000", // 100 fork-ETH, local only
  ]);
  const shuyue = await ethers.getSigner(SHUYUE_WALLET);

  const tx = await guard.connect(shuyue).register("shuyue");
  await tx.wait();
  console.log("register('shuyue') OK, tx:", tx.hash);
  console.log("agentCount:", (await guard.agentCount()).toString());
  const profile = await guard.getProfile(SHUYUE_WALLET);
  console.log("profile.handle:", profile.handle, "| registered:", profile.registered);

  const reportHash = ethers.keccak256(ethers.toUtf8Bytes("fork-verify-report"));
  const tx2 = await guard.connect(shuyue).recordCheck(TARGET, 1, reportHash);
  await tx2.wait();
  console.log("recordCheck(WARN) OK, totalChecks:", (await guard.totalChecks()).toString());

  // Negative: a random wallet without an Agent ID must not register.
  const [, rando] = await ethers.getSigners();
  try {
    await guard.connect(rando).register("rando");
    console.log("ERROR: non-holder registration unexpectedly succeeded");
    process.exitCode = 1;
  } catch (e) {
    console.log("non-holder register correctly reverted");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
