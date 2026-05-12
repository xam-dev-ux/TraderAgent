import { parseUnits, maxUint256, encodeFunctionData } from "viem";
import { writeContract, walletClient, publicClient, account } from "./wallet.js";
import { USDC_ADDRESS, WETH_ADDRESS, UNISWAP_ROUTER, UNISWAP_POOL_FEE, BUILDER_CODE } from "./constants.js";
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

  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS, abi: USDC_ABI, functionName: "allowance",
    args: [account.address, UNISWAP_ROUTER],
  });

  if (allowance < amountIn) {
    const approveTx = await writeContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "approve",
      args: [UNISWAP_ROUTER, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    await new Promise((r) => setTimeout(r, 3000));
  }

  const swapParams = {
    tokenIn: USDC_ADDRESS as `0x${string}`, tokenOut: WETH_ADDRESS as `0x${string}`,
    fee: UNISWAP_POOL_FEE, recipient,
    amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
  };

  const { result } = await publicClient.simulateContract({
    account: account.address,
    address: UNISWAP_ROUTER,
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [swapParams],
  });

  // sendTransaction con calldata manual — dataSuffix del cliente se aplica correctamente
  const calldata = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [swapParams],
  });

  console.log(`[swap] builder: ${BUILDER_CODE || "none"} sending swap`);
  const swapTxHash = await walletClient.sendTransaction({
    to: UNISWAP_ROUTER,
    data: calldata,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTxHash });
  if (receipt.status !== "success") throw new Error("Swap revertido");

  logTransaction({
    type: "swap", txHash: swapTxHash, amountIn: amountUSDC,
    tokenIn: "USDC", tokenOut: "WETH", timestamp: Date.now(), status: "confirmed",
  });

  recordSwapOnChain(recipient, amountIn, result, swapTxHash).catch(console.error);

  return { swapTxHash, amountOut: result };
}
