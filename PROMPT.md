# TraderAgent — Spec de implementación

Agente de trading conversacional sobre XMTP/Base, réplica mejorada de ChatTrader con dos diferencias clave:

1. **SwapRegistry**: contrato Solidity en Base que registra en cadena cada swap ejecutado.
2. **Arquitectura owner/bot**: la wallet owner (la tuya personal) despliega contratos y registra al agente en ERC-8004; la wallet bot (ephemeral en Render) solo firma XMTP y ejecuta swaps.

---

## Estructura de monorepo

```
TraderAgent/
├── packages/
│   ├── contracts/          # Hardhat — deploy SwapRegistry + registro ERC-8004
│   ├── agent/              # Render — Node.js HTTP + XMTP listener
│   └── ui/                 # Vercel — React/Vite dashboard
├── package.json            # workspaces
└── .node-version           # 20.19.5
```

`package.json` raíz:
```json
{
  "name": "trader-agent",
  "private": true,
  "workspaces": ["packages/*"],
  "engines": { "node": ">=20 <22" }
}
```

`.node-version`: `20.19.5`

---

## packages/contracts

### Dependencias

```json
{
  "devDependencies": {
    "hardhat": "^2.22.0",
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "dotenv": "^16.0.0"
  }
}
```

### hardhat.config.ts

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    base: {
      url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      accounts: [process.env.OWNER_PRIVATE_KEY!],
      chainId: 8453,
    },
  },
};
export default config;
```

### packages/contracts/.env.example

```
OWNER_PRIVATE_KEY=0x...   # tu wallet personal — despliega contratos y registra en ERC-8004
OWNER_WALLET_ADDRESS=0x...
BASE_RPC_URL=https://mainnet.base.org
```

> **NUNCA** pongas aquí la private key del bot. Las keys del bot van solo en Render.

### src/SwapRegistry.sol

Contrato que cualquier instancia del agente puede llamar para registrar swaps onchain.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Registro onchain de swaps ejecutados por el agente TraderAgent.
///         owner = tu wallet personal. agent = wallet del bot (Render).
contract SwapRegistry {
    struct Swap {
        address user;
        uint256 amountInUSDC;   // 6 decimales
        uint256 amountOutWETH;  // 18 decimales
        bytes32 swapTxHash;
        uint256 timestamp;
    }

    address public owner;
    address public agent;

    Swap[] public swaps;
    mapping(address => uint256[]) private _userSwapIds;

    event SwapRecorded(
        address indexed user,
        uint256 amountInUSDC,
        uint256 amountOutWETH,
        bytes32 indexed swapTxHash,
        uint256 timestamp
    );

    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    constructor(address _agent) {
        owner = msg.sender;
        agent = _agent;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "SwapRegistry: not agent");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SwapRegistry: not owner");
        _;
    }

    /// @notice El bot llama esto después de cada swap confirmado.
    function recordSwap(
        address user,
        uint256 amountInUSDC,
        uint256 amountOutWETH,
        bytes32 swapTxHash
    ) external onlyAgent {
        uint256 id = swaps.length;
        swaps.push(Swap({
            user: user,
            amountInUSDC: amountInUSDC,
            amountOutWETH: amountOutWETH,
            swapTxHash: swapTxHash,
            timestamp: block.timestamp
        }));
        _userSwapIds[user].push(id);
        emit SwapRecorded(user, amountInUSDC, amountOutWETH, swapTxHash, block.timestamp);
    }

    /// @notice Cambia la wallet autorizada a registrar swaps (p.ej. al rotar la key del bot).
    function setAgent(address newAgent) external onlyOwner {
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ── Lecturas ──────────────────────────────────────────────────────────────

    function swapCount() external view returns (uint256) {
        return swaps.length;
    }

    /// @notice Últimos N swaps, ordenados del más reciente al más antiguo.
    function recentSwaps(uint256 n) external view returns (Swap[] memory result) {
        uint256 total = swaps.length;
        uint256 count = n > total ? total : n;
        result = new Swap[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = swaps[total - 1 - i];
        }
    }

    /// @notice Todos los swaps de un usuario concreto.
    function userSwaps(address user) external view returns (Swap[] memory result) {
        uint256[] storage ids = _userSwapIds[user];
        result = new Swap[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = swaps[ids[i]];
        }
    }

    /// @notice Volumen total en USDC (6 dec) que ha pasado por el agente.
    function totalVolumeUSDC() external view returns (uint256 total) {
        for (uint256 i = 0; i < swaps.length; i++) {
            total += swaps[i].amountInUSDC;
        }
    }
}
```

### scripts/deploy.ts

Despliega SwapRegistry desde la wallet owner. Graba las addresses en `deployments/base.json`.

```typescript
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

  const out = { SwapRegistry: address, owner: owner.address, agent: botAddress, deployedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(__dirname, "../deployments"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "../deployments/base.json"), JSON.stringify(out, null, 2));
  console.log("[deploy] saved to deployments/base.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### scripts/register8004.ts

Registra al agente en ERC-8004 IdentityRegistry desde la wallet owner.
El tokenURI incluye la URL del agente en Render, sus capacidades y la address del SwapRegistry.

```typescript
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
    inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }],
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

  const tokenURI = "data:application/json;base64," + Buffer.from(JSON.stringify({
    name: "TraderAgent",
    description: "AI swap agent — USDC→ETH via Uniswap V3 on Base, swaps recorded onchain",
    endpoint: agentUrl,
    capabilities: ["swap", "price", "analysis"],
    swapRegistry: deployments.SwapRegistry,
    version: "1.0.0",
  })).toString("base64");

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

  // Leer tokenId desde events o tokenOfOwnerByIndex
  const tokenId = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: REGISTER_ABI,
    functionName: "tokenOfOwnerByIndex",
    args: [account.address, 0n],
  });

  console.log(`[register] ERC8004_AGENT_ID=${tokenId}`);

  // Actualizar deployments/base.json con el tokenId
  deployments.erc8004TokenId = Number(tokenId);
  deployments.agentUrl = agentUrl;
  fs.writeFileSync(
    path.join(__dirname, "../deployments/base.json"),
    JSON.stringify(deployments, null, 2)
  );
  console.log("[register] Set ERC8004_AGENT_ID=" + tokenId + " in Render env vars");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### scripts/updateAgent.ts

Actualiza la wallet bot autorizada en SwapRegistry (p.ej. al rotar la key del bot).

```typescript
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const SET_AGENT_ABI = [{
  name: "setAgent",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{ name: "newAgent", type: "address" }],
  outputs: [],
}] as const;

async function main() {
  const newBotAddress = process.argv[2] as `0x${string}`;
  if (!newBotAddress?.startsWith("0x")) throw new Error("Usage: npx ts-node scripts/updateAgent.ts 0xNEW_BOT_ADDRESS");

  const account = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`);
  const deployments = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/base.json"), "utf8"));
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  const txHash = await walletClient.writeContract({
    address: deployments.SwapRegistry,
    abi: SET_AGENT_ABI,
    functionName: "setAgent",
    args: [newBotAddress],
  });
  console.log(`[updateAgent] setAgent(${newBotAddress}) tx: ${txHash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### packages/contracts/.env.example (deploy-time only)

```
OWNER_PRIVATE_KEY=0x...
OWNER_WALLET_ADDRESS=0x...
BOT_WALLET_ADDRESS=0x...       # address del bot (no su key)
BASE_RPC_URL=https://mainnet.base.org
AGENT_URL=https://trader-agent.onrender.com
```

---

## packages/agent

Node.js. Desplegado en Render. Nunca tiene la OWNER_PRIVATE_KEY.

### Dependencias

```json
{
  "name": "@trader/agent",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@xmtp/node-sdk": "4.5.1",
    "viem": "^2.21.0",
    "ox": "^0.14.20"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "engines": { "node": ">=20 <22" }
}
```

### src/constants.ts

```typescript
export const USDC_ADDRESS        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const WETH_ADDRESS        = "0x4200000000000000000000000000000000000006";
export const UNISWAP_ROUTER      = "0x2626664c2603336E57B271c5C0b26F421741e481";
export const UNISWAP_POOL_FEE    = 500;
export const IDENTITY_REGISTRY   = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

export const SWAP_REGISTRY        = (process.env.SWAP_REGISTRY_ADDRESS ?? "") as `0x${string}`;
export const BOT_ADDRESS          = (process.env.BOT_ADDRESS ?? "") as `0x${string}`;
export const BOT_URL              = process.env.BOT_URL ?? "http://localhost:3000";
export const BUILDER_CODE         = process.env.BUILDER_CODE ?? "";
export const ERC8004_AGENT_ID     = Number(process.env.ERC8004_AGENT_ID ?? "0");
export const BASE_RPC_URL         = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
export const PORT                 = Number(process.env.PORT ?? 3000);
export const PRICE_PER_ANALYSIS   = Number(process.env.PRICE_PER_ANALYSIS ?? "0.01");
export const SWAP_FEE_USDC        = Number(process.env.SWAP_FEE_USDC ?? "0.02");
export const MIN_SWAP_USDC        = Number(process.env.MIN_SWAP_USDC ?? "5");
```

### src/wallet.ts

```typescript
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { BASE_RPC_URL, BUILDER_CODE } from "./constants.js";

// ERC-8021: attributor builder code en todas las txs del bot
function toBuilderBytes(code: string): `0x${string}` {
  if (code.startsWith("0x")) return code as `0x${string}`;
  return ("0x" + Buffer.from(code, "utf8").toString("hex")) as `0x${string}`;
}

export const account = privateKeyToAccount(process.env.BOT_PRIVATE_KEY as `0x${string}`);

export const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(BASE_RPC_URL),
  ...(BUILDER_CODE ? { dataSuffix: toBuilderBytes(BUILDER_CODE) } : {}),
});

export const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});
```

### src/swapRegistry.ts

Interfaz del agente con el contrato SwapRegistry. El bot llama a `recordSwap()` después de cada swap confirmado. Si falla no interrumpe el flujo (fire-and-forget con log).

```typescript
import { SWAP_REGISTRY } from "./constants.js";
import { walletClient, publicClient } from "./wallet.js";

const RECORD_SWAP_ABI = [
  {
    name: "recordSwap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user",           type: "address" },
      { name: "amountInUSDC",   type: "uint256" },
      { name: "amountOutWETH",  type: "uint256" },
      { name: "swapTxHash",     type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "recentSwaps",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "n", type: "uint256" }],
    outputs: [{
      type: "tuple[]",
      components: [
        { name: "user",          type: "address" },
        { name: "amountInUSDC",  type: "uint256" },
        { name: "amountOutWETH", type: "uint256" },
        { name: "swapTxHash",    type: "bytes32" },
        { name: "timestamp",     type: "uint256" },
      ],
    }],
  },
  {
    name: "swapCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalVolumeUSDC",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export async function recordSwapOnChain(
  user: `0x${string}`,
  amountInUSDC: bigint,
  amountOutWETH: bigint,
  swapTxHash: `0x${string}`,
): Promise<void> {
  if (!SWAP_REGISTRY) return;
  try {
    const txHash32 = (swapTxHash.padEnd(66, "0")) as `0x${string}`;
    const txHash = await walletClient.writeContract({
      address: SWAP_REGISTRY,
      abi: RECORD_SWAP_ABI,
      functionName: "recordSwap",
      args: [user, amountInUSDC, amountOutWETH, txHash32 as `0x${string}`],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
    console.log(`[registry] swap recorded onchain: ${txHash}`);
  } catch (e) {
    console.error("[registry] recordSwap failed (non-fatal):", e);
  }
}

export async function getOnChainStats(): Promise<{
  count: number;
  volumeUSDC: number;
  recent: Array<{ user: string; amountInUSDC: number; amountOutWETH: number; swapTxHash: string; timestamp: number }>;
}> {
  if (!SWAP_REGISTRY) return { count: 0, volumeUSDC: 0, recent: [] };
  const [count, volume, recent] = await Promise.all([
    publicClient.readContract({ address: SWAP_REGISTRY, abi: RECORD_SWAP_ABI, functionName: "swapCount" }),
    publicClient.readContract({ address: SWAP_REGISTRY, abi: RECORD_SWAP_ABI, functionName: "totalVolumeUSDC" }),
    publicClient.readContract({ address: SWAP_REGISTRY, abi: RECORD_SWAP_ABI, functionName: "recentSwaps", args: [20n] }),
  ]);
  return {
    count: Number(count),
    volumeUSDC: Number(volume) / 1e6,
    recent: (recent as any[]).map((s: any) => ({
      user: s.user,
      amountInUSDC: Number(s.amountInUSDC) / 1e6,
      amountOutWETH: Number(s.amountOutWETH) / 1e18,
      swapTxHash: s.swapTxHash,
      timestamp: Number(s.timestamp) * 1000,
    })),
  };
}
```

### src/swap.ts

Igual que ChatTrader pero llama a `recordSwapOnChain` tras el swap.

```typescript
import { parseUnits, maxUint256, encodeFunctionData } from "viem";
import { walletClient, publicClient, account } from "./wallet.js";
import { USDC_ADDRESS, WETH_ADDRESS, UNISWAP_ROUTER, UNISWAP_POOL_FEE } from "./constants.js";
import { recordSwapOnChain } from "./swapRegistry.js";
import { logTransaction } from "./transactions.js";

const USDC_ABI = [
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
] as const;

const ROUTER_ABI = [{
  name: "exactInputSingle",
  type: "function",
  stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn",           type: "address" },
    { name: "tokenOut",          type: "address" },
    { name: "fee",               type: "uint24"  },
    { name: "recipient",         type: "address" },
    { name: "amountIn",          type: "uint256" },
    { name: "amountOutMinimum",  type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
  ]}],
  outputs: [{ name: "amountOut", type: "uint256" }],
}] as const;

export async function executeSwap(
  amountUSDC: number,
  recipient: `0x${string}`,
): Promise<{ swapTxHash: `0x${string}`; amountOut: bigint }> {
  const amountIn = parseUnits(String(amountUSDC), 6);

  // Aprobar si hace falta
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS, abi: USDC_ABI, functionName: "allowance",
    args: [account.address, UNISWAP_ROUTER],
  });

  if (allowance < amountIn) {
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "approve",
      args: [UNISWAP_ROUTER, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    await new Promise((r) => setTimeout(r, 3000)); // propagation
  }

  // Simular y ejecutar
  const { result } = await publicClient.simulateContract({
    account: account.address,
    address: UNISWAP_ROUTER,
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: USDC_ADDRESS, tokenOut: WETH_ADDRESS,
      fee: UNISWAP_POOL_FEE, recipient,
      amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
    }],
  });

  const swapTxHash = await walletClient.writeContract({
    address: UNISWAP_ROUTER,
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: USDC_ADDRESS, tokenOut: WETH_ADDRESS,
      fee: UNISWAP_POOL_FEE, recipient,
      amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
    }],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTxHash });
  if (receipt.status !== "success") throw new Error("Swap revertido");

  logTransaction({ type: "swap", txHash: swapTxHash, amountIn: amountUSDC,
    tokenIn: "USDC", tokenOut: "WETH", timestamp: Date.now(), status: "confirmed" });

  // Registro onchain en SwapRegistry (fire-and-forget, no bloquea respuesta al usuario)
  recordSwapOnChain(recipient, amountIn, result, swapTxHash).catch(console.error);

  return { swapTxHash, amountOut: result };
}
```

### src/x402.ts

Copia exacta de ChatTrader (EIP-3009 settlement).

```typescript
import { walletClient, publicClient } from "./wallet.js";
import { USDC_ADDRESS } from "./constants.js";
import { logTransaction } from "./transactions.js";

const TRANSFER_WITH_AUTH_ABI = [{
  name: "transferWithAuthorization",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
    { name: "v",           type: "uint8"   },
    { name: "r",           type: "bytes32" },
    { name: "s",           type: "bytes32" },
  ],
  outputs: [],
}] as const;

export function build402Header(amountUSDC: number, botAddress: string, description: string): string {
  return Buffer.from(JSON.stringify({
    x402Version: "1",
    requirements: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: String(Math.round(amountUSDC * 1e6)),
      token: USDC_ADDRESS,
      payTo: botAddress,
      description,
    }],
  })).toString("base64");
}

export async function settleX402Payment(xPaymentHeader: string) {
  const payment = JSON.parse(Buffer.from(xPaymentHeader, "base64").toString("utf8"));
  if (payment.scheme !== "exact") throw new Error(`Unsupported scheme: ${payment.scheme}`);
  if (!["eip155:8453", "base-mainnet"].includes(payment.network))
    throw new Error(`Wrong network: ${payment.network}`);

  const { authorization, signature } = payment.payload;
  const botAddr = (process.env.BOT_ADDRESS as string).toLowerCase();
  if (authorization.to.toLowerCase() !== botAddr)
    throw new Error(`Payment to wrong address: ${authorization.to}`);

  const now = Math.floor(Date.now() / 1000);
  if (now < Number(authorization.validAfter))  throw new Error("Authorization not yet valid");
  if (now > Number(authorization.validBefore)) throw new Error("Authorization expired");

  const raw = (signature as string).replace(/^0x/i, "").toLowerCase();
  if (raw.length < 128) throw new Error(`Signature too short: ${raw.length}`);
  const r = `0x${raw.slice(0, 64)}` as `0x${string}`;
  const s = `0x${raw.slice(64, 128)}` as `0x${string}`;
  const vRaw = raw.length >= 130 ? parseInt(raw.slice(128, 130), 16) : 27;
  const v = vRaw < 27 ? vRaw + 27 : vRaw;

  const txHash = await walletClient.writeContract({
    address: USDC_ADDRESS, abi: TRANSFER_WITH_AUTH_ABI,
    functionName: "transferWithAuthorization",
    args: [
      authorization.from as `0x${string}`, authorization.to as `0x${string}`,
      BigInt(authorization.value), BigInt(authorization.validAfter),
      BigInt(authorization.validBefore), authorization.nonce as `0x${string}`,
      v, r, s,
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  logTransaction({ type: "payment_received", txHash, amountIn: Number(authorization.value) / 1e6,
    tokenIn: "USDC", from: authorization.from, timestamp: Date.now(), status: "confirmed" });

  return { userAddress: authorization.from as `0x${string}`, amountUSDC: Number(authorization.value) / 1e6, txHash };
}
```

### src/handler.ts

```typescript
export type Intent =
  | { type: "price";    token: string   }
  | { type: "analysis"; token: string   }
  | { type: "swap";     amount: number  }
  | { type: "balance"                   }
  | { type: "history"                   }
  | { type: "help"                      }
  | { type: "unknown"                   };

export function parseIntent(text: string): Intent {
  const t = text.toLowerCase().trim();
  if (/^(help|\?)$/.test(t))                                  return { type: "help" };
  if (/\bbalance\b/.test(t))                                   return { type: "balance" };
  if (/\b(history|historial|mis\s+swaps)\b/.test(t))           return { type: "history" };
  if (/\bprice\b.*?(\w+)|(\w+)\s+price/.test(t)) {
    const m = t.match(/price\s+(?:of\s+)?(\w+)|(\w+)\s+price/);
    return { type: "price", token: (m?.[1] ?? m?.[2] ?? "eth").toLowerCase() };
  }
  if (/\bprecio\b.*?(\w+)|(\w+)\s+precio/.test(t)) {
    const m = t.match(/precio\s+(?:de\s+)?(\w+)|(\w+)\s+precio/);
    return { type: "price", token: (m?.[1] ?? m?.[2] ?? "eth").toLowerCase() };
  }
  if (/analy[sz]e?\s+(\w+)/.test(t)) {
    const m = t.match(/analy[sz]e?\s+(\w+)/);
    return { type: "analysis", token: m?.[1]?.toLowerCase() ?? "eth" };
  }
  if (/\bswap\s+([\d.]+)\s*usdc/.test(t)) {
    const m = t.match(/\bswap\s+([\d.]+)\s*usdc/);
    return { type: "swap", amount: Number(m?.[1] ?? "0") };
  }
  return { type: "unknown" };
}
```

### src/prices.ts

Copia exacta de ChatTrader (CryptoCompare → Kraken → CoinGecko).

```typescript
export type PriceData = { usd: number; usd_24h_change: number };

const SYMBOL_MAP: Record<string, string> = {
  eth: "ETH", btc: "BTC", sol: "SOL", doge: "DOGE",
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL",
};

export async function getPrice(token: string): Promise<PriceData> {
  const sym = SYMBOL_MAP[token.toLowerCase()] ?? token.toUpperCase();

  // 1. CryptoCompare
  try {
    const r = await fetch(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${sym}&tsyms=USD`,
      { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const d = (await r.json()) as any;
      const raw = d.RAW?.[sym]?.USD;
      if (raw) return { usd: raw.PRICE, usd_24h_change: raw.CHANGEPCT24HOUR };
    }
  } catch {}

  // 2. Kraken
  try {
    const pair = sym === "BTC" ? "XBTUSD" : `${sym}USD`;
    const r = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`,
      { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const d = (await r.json()) as any;
      const key = Object.keys(d.result ?? {})[0];
      if (key) return { usd: Number(d.result[key].c[0]), usd_24h_change: Number(d.result[key].P[1]) };
    }
  } catch {}

  throw new Error(`No price data for ${sym}`);
}
```

### src/transactions.ts

```typescript
import fs from "fs";
const LOG_FILE = "/tmp/traderagent-txlog.json";

export type Transaction = {
  type: "swap" | "payment_received" | "payment_sent";
  txHash: string;
  amountIn?: number;
  amountOut?: number;
  tokenIn?: string;
  tokenOut?: string;
  from?: string;
  timestamp: number;
  status: "confirmed" | "pending" | "failed";
};

let _log: Transaction[] = [];
try { _log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch {}

export function logTransaction(tx: Transaction): void {
  _log.unshift(tx);
  if (_log.length > 200) _log.length = 200;
  fs.writeFileSync(LOG_FILE, JSON.stringify(_log));
}

export function getTransactions(): Transaction[] { return _log; }
```

### src/payPage.ts

Misma mecánica que ChatTrader: USDC.transfer desde la wallet del usuario, polling de payment-status.

```typescript
export function buildPayPage(amountUSDC: number, description: string, botAddress: string, nonce: string): string {
  const amountMicro = String(Math.round(amountUSDC * 1e6));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pay · TraderAgent</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0b0d; color: #f1f5f9; min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 16px; }
    .card { background: #131720; border: 1px solid #1e2736; border-radius: 20px;
      padding: 36px 32px; max-width: 420px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
    .logo { font-size: 22px; font-weight: 800; margin-bottom: 4px;
      background: linear-gradient(90deg,#0052ff,#00c3ff);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .tagline { color: #475569; font-size: 13px; margin-bottom: 28px; }
    .amount-card { background: #0d1117; border: 1px solid #1e2736; border-radius: 14px;
      padding: 24px; text-align: center; margin-bottom: 24px; }
    .amount-value { font-size: 44px; font-weight: 800; line-height: 1.1; }
    .amount-unit  { font-size: 16px; color: #0052ff; font-weight: 600; margin-top: 6px; }
    .amount-desc  { font-size: 13px; color: #64748b; margin-top: 10px; }
    .btn { width: 100%; padding: 16px; border: none; border-radius: 12px;
      font-size: 16px; font-weight: 700; cursor: pointer; transition: all .2s; }
    .btn:disabled { opacity: .4; cursor: not-allowed; }
    .btn-pay { background: linear-gradient(135deg,#0052ff,#0070f3); color: #fff; }
    .btn-pay:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,82,255,.45); }
    .status { margin-top: 16px; padding: 14px 16px; border-radius: 10px; font-size: 14px;
      line-height: 1.55; display: none; word-break: break-word; }
    .status.loading { background: #0e1f3d; color: #93c5fd; display: block; }
    .status.success { background: #052e16; color: #4ade80; display: block; }
    .status.error   { background: #2d0f0f; color: #f87171; display: block; }
    .tx-link { display: block; margin-top: 8px; color: #4ade80; text-decoration: underline; font-size: 13px; }
    .powered { text-align: center; margin-top: 20px; font-size: 12px; color: #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">TraderAgent</div>
    <div class="tagline">AI swap agent · Base Network</div>
    <div class="amount-card">
      <div class="amount-value">${amountUSDC}</div>
      <div class="amount-unit">USDC on Base</div>
      <div class="amount-desc">${description}</div>
    </div>
    <button class="btn btn-pay" id="pay-btn">Pay with Base Wallet</button>
    <div class="status" id="status"></div>
    <div class="powered">ERC-20 Transfer · Base Mainnet</div>
  </div>

  <script type="module">
    import { createWalletClient, custom, encodeFunctionData } from 'https://esm.sh/viem@2.21.0';
    import { base } from 'https://esm.sh/viem@2.21.0/chains';

    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const BOT_ADDRESS  = '${botAddress}';
    const AMOUNT_MICRO = ${amountMicro}n;
    const NONCE        = '${nonce}';

    const TRANSFER_ABI = [{
      name: 'transfer', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
      outputs: [{ name: '', type: 'bool' }],
    }];

    function setStatus(html, type) {
      const el = document.getElementById('status');
      el.innerHTML = html; el.className = 'status ' + type;
    }

    document.getElementById('pay-btn').addEventListener('click', async () => {
      const btn = document.getElementById('pay-btn');
      btn.disabled = true;
      try {
        setStatus('Connecting wallet…', 'loading');
        if (!window.ethereum) throw new Error('No wallet. Install Coinbase Wallet or MetaMask.');
        const wc = createWalletClient({ chain: base, transport: custom(window.ethereum) });
        const [userAddress] = await wc.requestAddresses();

        setStatus('Switching to Base…', 'loading');
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
        } catch(e) {
          if (e.code === 4902) await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
            chainId: '0x2105', chainName: 'Base',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'],
          }]}); else throw e;
        }

        setStatus('Approve the USDC transfer in your wallet…', 'loading');
        const data = encodeFunctionData({ abi: TRANSFER_ABI, functionName: 'transfer', args: [BOT_ADDRESS, AMOUNT_MICRO] });
        const txHash = await wc.sendTransaction({ account: userAddress, to: USDC_ADDRESS, data });

        setStatus('Waiting for confirmation…', 'loading');
        const resp = await fetch('/api/confirm-payment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash, nonce: NONCE, userAddress }),
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Server error');

        btn.textContent = '✓ Paid';
        setStatus('⏳ Confirmed! Executing swap…<a class="tx-link" href="https://basescan.org/tx/' + txHash + '" target="_blank">View payment →</a>', 'loading');

        let polls = 0;
        const poll = setInterval(async () => {
          if (++polls > 40) {
            clearInterval(poll);
            setStatus('✓ Paid. Result coming in XMTP chat.<a class="tx-link" href="https://basescan.org/tx/' + txHash + '" target="_blank">View payment →</a>', 'success');
            return;
          }
          try {
            const s = await fetch('/api/payment-status/' + NONCE).then(r => r.json());
            if (s.status === 'done') {
              clearInterval(poll);
              setStatus('✓ Swap done! ETH sent to your wallet.' +
                (s.swapTxHash ? '<a class="tx-link" href="https://basescan.org/tx/' + s.swapTxHash + '" target="_blank">View swap on Basescan →</a>' : ''), 'success');
            } else if (s.status === 'failed') {
              clearInterval(poll); setStatus('Failed: ' + s.error, 'error');
              btn.disabled = false;
            }
          } catch {}
        }, 3000);

      } catch(err) {
        setStatus('Error: ' + (err.shortMessage || err.message || String(err)), 'error');
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
```

### src/index.ts

HTTP server + XMTP listener. Estructura idéntica a ChatTrader.

**Endpoints HTTP:**

| Método | Ruta | Autenticación | Descripción |
|--------|------|--------------|-------------|
| GET | `/health` | — | uptime, botAddress |
| GET | `/api/analyze/:token?nonce=` | x402 / browser | serve pay page o ejecutar análisis |
| GET | `/api/swap/:amount?nonce=` | x402 / browser | serve pay page o ejecutar swap |
| POST | `/api/confirm-payment` | — | browser notifica txHash, ejecuta acción |
| GET | `/api/payment-status/:nonce` | — | browser hace polling del resultado |
| GET | `/api/transactions` | — | dashboard: log de transacciones |
| GET | `/api/stats` | — | dashboard: KPIs (del contrato + in-memory) |
| GET | `/api/chain-stats` | — | stats directos del SwapRegistry onchain |

**Sesiones en memoria** (igual que ChatTrader):

```typescript
const pendingPayments = new Map<string, {
  type: "analysis" | "swap";
  token?: string;
  amount?: number;
  userAddress: `0x${string}`;
  send: (text: string) => Promise<void>;
  expiresAt: number;
}>();

const paymentStatus = new Map<string, {
  status: "processing" | "done" | "failed";
  swapTxHash?: string;
  error?: string;
}>();
```

**Lógica x402 de los endpoints de pago — implementación exacta**

Cada vez que el usuario pide un swap o un análisis desde XMTP, el bot:
1. Genera un `nonce` UUID y guarda la acción pendiente en `pendingPayments`
2. Responde con la URL `${BOT_URL}/api/swap/${amount}?nonce=${nonce}`

Cuando el usuario abre esa URL, el servidor detecta el contexto y aplica una de tres ramas:

```typescript
// GET /api/swap/:amount?nonce=...
const swapMatch = pathname.match(/^\/api\/swap\/([\d.]+)$/);
if (swapMatch) {
  const amount = Number(swapMatch[1]);
  const nonce  = url.searchParams.get("nonce") ?? "";
  const xPayment = req.headers["x-payment"] as string | undefined;
  const totalCost = amount + SWAP_FEE_USDC;

  // ── Rama 1: browser sin header X-Payment → servir pay page HTML ──────────
  if (!xPayment && req.headers.accept?.includes("text/html")) {
    cors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildPayPage(totalCost, `Swap ${amount} USDC → ETH`, BOT_ADDRESS, nonce));
    return;
  }

  // ── Rama 2: cliente programático sin pago → 402 con requisitos ───────────
  if (!xPayment) {
    const header402 = build402Header(totalCost, BOT_ADDRESS, `Swap ${amount} USDC → ETH`);
    cors(res);
    res.writeHead(402, {
      "Content-Type": "application/json",
      "X-PAYMENT-REQUIRED": header402,
    });
    res.end(JSON.stringify({ error: "Payment required", amountUSDC: totalCost }));
    return;
  }

  // ── Rama 3: cliente programático con X-Payment → cobrar y ejecutar ───────
  try {
    const settled = await settleX402Payment(xPayment);
    console.log(`[x402] swap settled from=${settled.userAddress} tx=${settled.txHash}`);

    const { swapTxHash, amountOut } = await executeSwap(amount, settled.userAddress);
    const resultText = [
      `✅ Swap executed!`,
      `   ${amount} USDC → ${(Number(amountOut) / 1e18).toFixed(6)} WETH`,
      `   https://basescan.org/tx/${swapTxHash}`,
    ].join("\n");

    // Notificar al usuario por XMTP si el swap venía de un comando XMTP
    const pending = pendingPayments.get(nonce);
    if (pending) {
      pending.send(resultText).catch((e) => console.error("[x402] xmtp notify:", e));
      paymentStatus.set(nonce, { status: "done", swapTxHash });
      pendingPayments.delete(nonce);
    }

    return json(res, { swapTxHash, paymentTxHash: settled.txHash, amountOut: Number(amountOut) });
  } catch (err) {
    console.error("[x402] swap error:", err);
    const pending = pendingPayments.get(nonce);
    if (pending) {
      pending.send(`❌ Swap failed: ${(err as Error).message}`).catch(() => {});
      paymentStatus.set(nonce, { status: "failed", error: (err as Error).message });
      pendingPayments.delete(nonce);
    }
    return json(res, { error: (err as Error).message }, 400);
  }
}

// GET /api/analyze/:token?nonce=...  — misma lógica de tres ramas
const analyzeMatch = pathname.match(/^\/api\/analyze\/([a-z]+)$/);
if (analyzeMatch) {
  const token    = analyzeMatch[1];
  const nonce    = url.searchParams.get("nonce") ?? "";
  const xPayment = req.headers["x-payment"] as string | undefined;

  if (!xPayment && req.headers.accept?.includes("text/html")) {
    cors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildPayPage(PRICE_PER_ANALYSIS, `Analysis of ${token.toUpperCase()}`, BOT_ADDRESS, nonce));
    return;
  }

  if (!xPayment) {
    cors(res);
    res.writeHead(402, {
      "Content-Type": "application/json",
      "X-PAYMENT-REQUIRED": build402Header(PRICE_PER_ANALYSIS, BOT_ADDRESS, `Analysis of ${token.toUpperCase()}`),
    });
    res.end(JSON.stringify({ error: "Payment required", amountUSDC: PRICE_PER_ANALYSIS }));
    return;
  }

  try {
    const settled = await settleX402Payment(xPayment);
    const result  = await runAnalysis(token);  // tu función de análisis técnico
    const pending = pendingPayments.get(nonce);
    if (pending) {
      pending.send(result).catch((e) => console.error("[x402] xmtp notify:", e));
      paymentStatus.set(nonce, { status: "done" });
      pendingPayments.delete(nonce);
    }
    return json(res, { analysis: result, txHash: settled.txHash });
  } catch (err) {
    return json(res, { error: (err as Error).message }, 400);
  }
}
```

**POST /api/confirm-payment** — camino del browser (igual que ChatTrader):

```typescript
// El browser manda { txHash, nonce, userAddress } tras enviar la tx ERC-20
if (pathname === "/api/confirm-payment" && req.method === "POST") {
  const { txHash, nonce, userAddress } = body;

  paymentStatus.set(nonce, { status: "processing" });
  json(res, { status: "processing", txHash }); // responder inmediatamente

  (async () => {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`, timeout: 120_000,
    });
    if (receipt.status !== "success") {
      paymentStatus.set(nonce, { status: "failed", error: "Transaction reverted" });
      pendingPayments.get(nonce)?.send("❌ Payment reverted.").catch(() => {});
      pendingPayments.delete(nonce);
      return;
    }

    const pending = pendingPayments.get(nonce);
    if (!pending) return;

    if (pending.type === "swap") {
      try {
        const { swapTxHash, amountOut } = await executeSwap(pending.amount!, userAddress as `0x${string}`);
        paymentStatus.set(nonce, { status: "done", swapTxHash });
        await pending.send([
          `✅ Swap executed!`,
          `   ${pending.amount} USDC → ${(Number(amountOut) / 1e18).toFixed(6)} WETH`,
          `   https://basescan.org/tx/${swapTxHash}`,
        ].join("\n"));
      } catch (err) {
        paymentStatus.set(nonce, { status: "failed", error: (err as Error).message });
        await pending.send(`❌ Swap failed: ${(err as Error).message}`);
      }
    } else if (pending.type === "analysis") {
      const result = await runAnalysis(pending.token!);
      paymentStatus.set(nonce, { status: "done" });
      await pending.send(result);
    }

    pendingPayments.delete(nonce);
  })().catch(console.error);
  return;
}
```

**Flujo completo cuando el usuario escribe "swap 10 usdc" en XMTP:**

```
Usuario (XMTP)  →  "swap 10 usdc"
Bot             →  parseIntent() → { type: "swap", amount: 10 }
Bot             →  nonce = randomUUID()
Bot             →  pendingPayments.set(nonce, { type:"swap", amount:10, send, ... })
Bot  →  XMTP→  "Swap 10 USDC→ETH costs $10.02\nPay: https://…/api/swap/10?nonce=UUID"

Usuario (browser) → abre la URL
Servidor          → Accept: text/html → buildPayPage(10.02, ..., nonce) → HTML
Usuario           → "Pay with Base Wallet" → wallet popup → USDC.transfer(BOT_ADDRESS, 10.02 USDC)
Browser           → POST /api/confirm-payment { txHash, nonce, userAddress }
Servidor          → "processing" (respuesta inmediata)
Servidor (bg)     → waitForTransactionReceipt(txHash)
Servidor (bg)     → executeSwap(10, userAddress) → Uniswap V3 → swapTxHash
Servidor (bg)     → recordSwapOnChain(userAddress, amountIn, amountOut, swapTxHash)  ← NUEVO
Servidor (bg)     → paymentStatus.set(nonce, { status:"done", swapTxHash })
Servidor (bg)     → pending.send("✅ Swap executed! ... basescan link")

Browser           → poll /api/payment-status/UUID → { status:"done", swapTxHash }
Browser           → muestra "✓ Swap done! ETH sent." + link a Basescan

Usuario (XMTP)    → recibe también "✅ Swap executed!" en el chat
```

**GET /api/stats** lee del contrato onchain + in-memory:
```typescript
const chainStats = await getOnChainStats();
json(res, {
  totalSwaps: chainStats.count,         // desde SwapRegistry
  totalVolumeUSDC: chainStats.volumeUSDC, // desde SwapRegistry
  uptime: Math.floor((Date.now() - startTime) / 1000),
  botAddress: BOT_ADDRESS,
  builderCode: BUILDER_CODE,
});
```

**Comandos XMTP:**

| Comando | Coste | Respuesta |
|---------|-------|-----------|
| `help` | gratis | Menú de comandos |
| `price eth/btc/sol/doge` | gratis | Precio actual + sentiment |
| `balance` | gratis | USDC + ETH del bot |
| `history` o `historial` | gratis | Últimos 5 swaps del usuario (del contrato) |
| `analyze eth` | $0.01 USDC | Link x402 → análisis técnico |
| `swap 10 usdc` | $10 + $0.02 | Link x402 → swap USDC→ETH vía Uniswap V3 |

**Mensaje de help:**
```
TraderAgent 🤖

Commands:
  price eth       — live ETH price (free)
  analyze eth     — technical analysis ($0.01)
  swap 10 usdc    — swap USDC→ETH ($0.02 fee)
  balance         — bot wallet balance
  history         — your swap history (onchain)
  help            — this message

Swaps are recorded onchain on Base via SwapRegistry.
View dashboard: ${DASHBOARD_URL}
```

**Keep-alive** (igual que Switchboard — previene sleep en Render free tier):
```typescript
if (BOT_URL) {
  setInterval(() => fetch(`${BOT_URL}/health`).catch(() => {}), 10 * 60 * 1000);
}
```

**XMTP init** (igual que ChatTrader):
```typescript
import { Client, IdentifierKind } from "@xmtp/node-sdk";
// type: "EOA", getIdentifier, signMessage → Uint8Array
// Client.create(signer, { dbEncryptionKey: keccak256(privateKey), env: "production" })
// revokeAllOtherInstallations()
// conversations.sync()
// while(true) { streamAllMessages() }
```

### .env.example (Render)

```
# Bot wallet (generada con cast wallet new, NUNCA compartir)
BOT_PRIVATE_KEY=0x...
BOT_ADDRESS=0x...

# Contratos desplegados por el script deploy
SWAP_REGISTRY_ADDRESS=0x...   # output de npm run deploy

# ERC-8004
ERC8004_AGENT_ID=...           # output de npm run register

# ERC-8021 builder attribution
BUILDER_CODE=bc_...

# URLs
BASE_RPC_URL=https://mainnet.base.org
BOT_URL=https://trader-agent.onrender.com       # actualizar tras primer deploy
DASHBOARD_URL=https://trader-agent-ui.vercel.app

# Fees
PRICE_PER_ANALYSIS=0.01
SWAP_FEE_USDC=0.02
MIN_SWAP_USDC=5

# Render
PORT=3000
```

---

## packages/ui

React + Vite, deploy en Vercel. Misma estructura terminal/CRT que ChatTrader pero con una pestaña extra **Onchain** que muestra los últimos 20 swaps leídos directamente del contrato SwapRegistry (vía `/api/chain-stats`).

### Diferencias vs ChatTrader UI

1. Logo: **TraderAgent** en lugar de ChatTrader
2. Stats card extra: "Onchain Swaps" (del contrato, no en memoria)
3. Pestaña **Onchain** en la tabla: lista los swaps del contrato con user, amountIn, amountOut, timestamp, txHash linkado a Basescan
4. `api.ts` añade `fetchChainStats()` que llama a `/api/chain-stats`

### vercel.json

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "env": {
    "VITE_AGENT_API_URL": "https://trader-agent.onrender.com"
  }
}
```

---

## Orden de despliegue

### 1. Wallet bot nueva

```bash
cast wallet new
# → guarda la private key y la address
```

Fondear la bot wallet con ~0.005 ETH + algo de USDC en Base.

### 2. Desplegar SwapRegistry

```bash
cd packages/contracts
cp .env.example .env
# rellenar OWNER_PRIVATE_KEY, BOT_WALLET_ADDRESS, etc.
npx hardhat run scripts/deploy.ts --network base
# → guarda deployments/base.json con SwapRegistry address
```

### 3. Deploy en Render (sin ERC-8004 todavía)

- Crear Web Service en Render
- Root directory: `packages/agent`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Añadir env vars (BOT_PRIVATE_KEY, BOT_ADDRESS, SWAP_REGISTRY_ADDRESS, etc.)
- Anotar la URL: `https://trader-agent-xxxx.onrender.com`

### 4. Registrar en ERC-8004 desde owner wallet

```bash
cd packages/contracts
# Añadir al .env:
# AGENT_URL=https://trader-agent-xxxx.onrender.com
npx hardhat run scripts/register8004.ts --network base
# → imprime ERC8004_AGENT_ID
```

Añadir `ERC8004_AGENT_ID` a las env vars de Render.

### 5. Actualizar BOT_URL en Render

```
BOT_URL=https://trader-agent-xxxx.onrender.com
```

Guardar → Render redespliega.

### 6. Deploy dashboard en Vercel

- Conectar `packages/ui`
- `VITE_AGENT_API_URL=https://trader-agent-xxxx.onrender.com`
- Anotar URL del dashboard y añadirla a `DASHBOARD_URL` en Render

### 7. Verificar

```bash
curl https://trader-agent-xxxx.onrender.com/health
curl https://trader-agent-xxxx.onrender.com/api/chain-stats
```

Abrir Base App → mandar "help" a la bot address → recibir menú.

---

## Resumen de diferencias vs ChatTrader

| Aspecto | ChatTrader | TraderAgent |
|---------|-----------|-------------|
| Registro swaps | In-memory + /tmp JSON | In-memory + /tmp JSON + **SwapRegistry onchain** |
| Ownership contratos | — (sin contratos) | **OWNER_WALLET** despliega SwapRegistry |
| ERC-8004 registration | — | **OWNER_WALLET** llama `register()` en IdentityRegistry |
| Bot wallet | Firma todo | Solo XMTP + swaps (no toca contratos de ownership) |
| Dashboard stats | In-memory | In-memory + **lectura directa del contrato** |
| `history` command | Sin historial | Historial del usuario desde SwapRegistry |
| Rotación de key bot | Manual | `scripts/updateAgent.ts` (owner llama `setAgent()`) |
| `/api/chain-stats` | — | Endpoint nuevo (recentSwaps, totalVolumeUSDC del contrato) |

---

## Notas de seguridad

- `OWNER_PRIVATE_KEY` **solo existe en local** (`packages/contracts/.env`). Nunca en Render, nunca en git.
- `BOT_PRIVATE_KEY` solo en Render (variables de entorno secretas). Nunca en git.
- El contrato SwapRegistry tiene `onlyAgent` para evitar que nadie más registre swaps falsos.
- `amountOutMinimum: 0n` en el swap = sin protección de slippage. Para producción real calcular con quote de Uniswap V3 Quoter y aplicar 1% de tolerancia.
- Render free tier duerme a los 15 min. El keep-alive loop de 10 min previene esto si `BOT_URL` está configurado.
