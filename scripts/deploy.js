// Deploy GuardRegistry.
// Usage:
//   npx hardhat run scripts/deploy.js --network bscTestnet
//   npx hardhat run scripts/deploy.js --network bsc
// The Agent ID registry is a mainnet-only contract, so on BSC testnet this
// script deploys a MockAgentIdRegistry first and wires GuardRegistry to it.
// On BSC mainnet it wires GuardRegistry to the real SPACE ID Agent ID registry.
const { ethers, network } = require("hardhat");

const REAL_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("network:", network.name, "deployer:", deployer.address);

  let registryAddress = REAL_REGISTRY;
  if (network.name !== "bsc") {
    const Mock = await ethers.getContractFactory("MockAgentIdRegistry");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    registryAddress = await mock.getAddress();
    console.log("MockAgentIdRegistry deployed:", registryAddress);
  }

  const Guard = await ethers.getContractFactory("GuardRegistry");
  const guard = await Guard.deploy(registryAddress);
  await guard.waitForDeployment();
  console.log("GuardRegistry deployed:", await guard.getAddress());
  console.log("agentIdRegistry wired to:", registryAddress);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
