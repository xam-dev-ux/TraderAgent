// Elimina barra final independientemente de cómo venga configurada la variable
const BASE = (import.meta.env.VITE_AGENT_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

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

export type Stats = {
  totalSwaps: number;
  totalVolumeUSDC: number;
  uptime: number;
  botAddress: string;
};

export type ChainSwap = {
  user: string;
  amountInUSDC: number;
  amountOutWETH: number;
  swapTxHash: string;
  timestamp: number;
};

export type ChainStats = {
  count: number;
  volumeUSDC: number;
  recent: ChainSwap[];
};

export async function fetchStats(): Promise<Stats> {
  const r = await fetch(`${BASE}/api/stats`);
  if (!r.ok) throw new Error(`stats ${r.status}`);
  return r.json();
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const r = await fetch(`${BASE}/api/transactions`);
  if (!r.ok) throw new Error(`transactions ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchChainStats(): Promise<ChainStats> {
  const r = await fetch(`${BASE}/api/chain-stats`);
  if (!r.ok) throw new Error(`chain-stats ${r.status}`);
  return r.json();
}
