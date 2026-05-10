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
export const DASHBOARD_URL        = process.env.DASHBOARD_URL ?? "";
