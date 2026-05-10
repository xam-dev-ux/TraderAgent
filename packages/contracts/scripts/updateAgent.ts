import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const SET_AGENT_ABI = [
  {
    name: "setAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAgent", type: "address" }],
    outputs: [],
  },
] as const;

async function main() {
  const newBotAddress = process.argv[2] as `0x${string}`;
  if (!newBotAddress?.startsWith("0x"))
    throw new Error("Usage: npx ts-node scripts/updateAgent.ts 0xNEW_BOT_ADDRESS");

  const account = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`);
  const deployments = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../deployments/base.json"), "utf8")
  );
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  const txHash = await walletClient.writeContract({
    address: deployments.SwapRegistry,
    abi: SET_AGENT_ABI,
    functionName: "setAgent",
    args: [newBotAddress],
  });
  console.log(`[updateAgent] setAgent(${newBotAddress}) tx: ${txHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
