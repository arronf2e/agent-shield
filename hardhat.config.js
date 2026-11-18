require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: process.env.BSC_FORK
      ? {
          forking: {
            url: process.env.BSC_RPC || "https://bsc-rpc.publicnode.com",
            ...(process.env.BSC_FORK_BLOCK
              ? { blockNumber: parseInt(process.env.BSC_FORK_BLOCK, 10) }
              : {}),
          },
        }
      : {},
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    bsc: {
      url: process.env.BSC_RPC || "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
