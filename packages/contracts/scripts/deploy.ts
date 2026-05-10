import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`[deploy] owner: ${owner.address}`);

  const botAddress = process.env.BOT_WALLET_ADDRESS;
  if (!botAddress) throw new Error("BOT_WALLET_ADDRESS not set in .env");

  const SwapRegistry = await ethers.getContractFactory("SwapRegistry");
  const registry = await SwapRegistry.deploy(botAddress);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log(`[deploy] SwapRegistry: ${address}`);

  const out = {
    SwapRegistry: address,
    owner: owner.address,
    agent: botAddress,
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(__dirname, "../deployments"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "../deployments/base.json"),
    JSON.stringify(out, null, 2)
  );
  console.log("[deploy] saved to deployments/base.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
