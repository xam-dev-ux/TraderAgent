import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { BASE_RPC_URL, BUILDER_CODE } from "./constants.js";

function toBuilderBytes(code: string): `0x${string}` {
  if (code.startsWith("0x")) return code as `0x${string}`;
  return ("0x" + Buffer.from(code, "utf8").toString("hex")) as `0x${string}`;
}

const pk = process.env.BOT_PRIVATE_KEY as `0x${string}`;
if (!pk) throw new Error("BOT_PRIVATE_KEY no está configurada");

export const account = privateKeyToAccount(pk);

export const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(BASE_RPC_URL),
});

export const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

// dataSuffix debe pasarse por llamada, no en createWalletClient
const builderSuffix: `0x${string}` | undefined = BUILDER_CODE
  ? toBuilderBytes(BUILDER_CODE)
  : undefined;

// Wrapper que inyecta el builder code en cada tx automáticamente
export function writeContract(
  args: Parameters<typeof walletClient.writeContract>[0]
): ReturnType<typeof walletClient.writeContract> {
  return walletClient.writeContract({
    ...args,
    ...(builderSuffix ? { dataSuffix: builderSuffix } : {}),
  } as Parameters<typeof walletClient.writeContract>[0]);
}
