import { createWalletClient, http, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const REGISTER_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "tokenOfOwnerByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function main() {
  const privateKey = process.env.OWNER_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) throw new Error("OWNER_PRIVATE_KEY not set");

  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) throw new Error("AGENT_URL not set (e.g. https://trader-agent.onrender.com)");

  const deployments = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../deployments/base.json"), "utf8")
  );

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain: base, transport: http() });
  const publicClient = createPublicClient({ chain: base, transport: http() });

  const tokenURI =
    "data:application/json;base64," +
    Buffer.from(
      JSON.stringify({
        name: "TraderAgent",
        description: "AI swap agent — USDC→ETH via Uniswap V3 on Base, swaps recorded onchain",
        endpoint: agentUrl,
        capabilities: ["swap", "price", "analysis"],
        swapRegistry: deployments.SwapRegistry,
        version: "1.0.0",
      })
    ).toString("base64");

  console.log(`[register] calling register() from owner: ${account.address}`);
  const txHash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTER_ABI,
    functionName: "register",
    args: [tokenURI],
  });

  console.log(`[register] tx: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`[register] confirmed in block ${receipt.blockNumber}`);

  const tokenId = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTER_ABI,
    functionName: "tokenOfOwnerByIndex",
    args: [account.address, 0n],
  });

  console.log(`[register] ERC8004_AGENT_ID=${tokenId}`);

  deployments.erc8004TokenId = Number(tokenId);
  deployments.agentUrl = agentUrl;
  fs.writeFileSync(
    path.join(__dirname, "../deployments/base.json"),
    JSON.stringify(deployments, null, 2)
  );
  console.log("[register] Set ERC8004_AGENT_ID=" + tokenId + " in Render env vars");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
