export type PriceData = { usd: number; usd_24h_change: number };

const SYMBOL_MAP: Record<string, string> = {
  eth: "ETH", btc: "BTC", sol: "SOL", doge: "DOGE",
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL",
};

export async function getPrice(token: string): Promise<PriceData> {
  const sym = SYMBOL_MAP[token.toLowerCase()] ?? token.toUpperCase();

  try {
    const r = await fetch(
      `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${sym}&tsyms=USD`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (r.ok) {
      const d = (await r.json()) as any;
      const raw = d.RAW?.[sym]?.USD;
      if (raw) return { usd: raw.PRICE, usd_24h_change: raw.CHANGEPCT24HOUR };
    }
  } catch {}

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
