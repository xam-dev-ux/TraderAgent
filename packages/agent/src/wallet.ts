import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Attribution } from "ox/erc8021";
import { BASE_RPC_URL, BUILDER_CODE } from "./constants.js";

const pk = process.env.BOT_PRIVATE_KEY as `0x${string}`;
if (!pk) throw new Error("BOT_PRIVATE_KEY no está configurada");

export const account = privateKeyToAccount(pk);

// ERC-8021: formato correcto con marcador 0x80210000 via ox/erc8021
const dataSuffix = BUILDER_CODE
  ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
  : undefined;

export const builderDataSuffix = dataSuffix;
console.log(`[wallet] builder code: ${BUILDER_CODE || "none"} dataSuffix: ${dataSuffix ?? "none"}`);

export const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(BASE_RPC_URL),
  ...(dataSuffix ? { dataSuffix } : {}),
});

export const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

// Wrapper para writeContract — inyecta dataSuffix en approve, recordSwap, x402
export function writeContract(
  args: Parameters<typeof walletClient.writeContract>[0]
): ReturnType<typeof walletClient.writeContract> {
  return walletClient.writeContract({
    ...args,
    ...(dataSuffix ? { dataSuffix } : {}),
  } as Parameters<typeof walletClient.writeContract>[0]);
}
