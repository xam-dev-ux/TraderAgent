import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

// Falla en el momento de carga si la key no está — nunca pasa undefined a accounts
const ownerKey = process.env.OWNER_PRIVATE_KEY;
if (!ownerKey && process.env.HARDHAT_NETWORK === "base") {
  throw new Error("OWNER_PRIVATE_KEY no está configurada en packages/contracts/.env");
}

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  paths: {
    sources: "./src",
  },
  networks: {
    base: {
      url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      accounts: ownerKey ? [ownerKey] : [],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY ?? "",
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },
};
export default config;
