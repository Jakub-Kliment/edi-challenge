import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          // Low `runs` optimises for DEPLOY SIZE over execution cost.
          // Correct trade-off here: the SVG string literals push us toward the
          // EIP-170 24576-byte bytecode limit, while tokenURI() is a free view
          // call whose execution cost nobody pays.
          optimizer: { enabled: true, runs: 1 },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 1 },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    amoy: {
      type: "http",
      chainType: "l1",
      url: configVariable("AMOY_RPC_URL"),
      accounts: [configVariable("RELAYER_PRIVATE_KEY")],
      chainId: 80002,
    },
    polygon: {
      type: "http",
      chainType: "l1",
      url: configVariable("POLYGON_RPC_URL"),
      accounts: [configVariable("RELAYER_PRIVATE_KEY")],
      chainId: 137,
    },
  },
});
