import { writeContract, publicClient } from "./wallet.js";
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

  const txHash = await writeContract({
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
  logTransaction({
    type: "payment_received", txHash, amountIn: Number(authorization.value) / 1e6,
    tokenIn: "USDC", from: authorization.from, timestamp: Date.now(), status: "confirmed",
  });

  return { userAddress: authorization.from as `0x${string}`, amountUSDC: Number(authorization.value) / 1e6, txHash };
}
