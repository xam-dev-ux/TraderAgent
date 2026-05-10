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
  if (/^(help|\?)$/.test(t))                                   return { type: "help" };
  if (/\bbalance\b/.test(t))                                    return { type: "balance" };
  if (/\b(history|historial|mis\s+swaps)\b/.test(t))            return { type: "history" };
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
