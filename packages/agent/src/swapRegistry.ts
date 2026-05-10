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
  {
    name: "userSwaps",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
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

export async function getUserSwaps(user: `0x${string}`): Promise<Array<{
  amountInUSDC: number;
  amountOutWETH: number;
  swapTxHash: string;
  timestamp: number;
}>> {
  if (!SWAP_REGISTRY) return [];
  try {
    const swaps = await publicClient.readContract({
      address: SWAP_REGISTRY,
      abi: RECORD_SWAP_ABI,
      functionName: "userSwaps",
      args: [user],
    });
    return (swaps as any[]).map((s: any) => ({
      amountInUSDC: Number(s.amountInUSDC) / 1e6,
      amountOutWETH: Number(s.amountOutWETH) / 1e18,
      swapTxHash: s.swapTxHash,
      timestamp: Number(s.timestamp) * 1000,
    })).reverse().slice(0, 5);
  } catch {
    return [];
  }
}
