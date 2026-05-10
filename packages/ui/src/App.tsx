import { useEffect, useState } from "react";
import {
  fetchStats, fetchTransactions, fetchChainStats,
  type Stats, type Transaction, type ChainStats,
} from "./api.js";

type Tab = "transactions" | "onchain";

function fmt(ts: number) {
  return new Date(ts).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
}

function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function basescanTx(hash: string) {
  return `https://basescan.org/tx/${hash}`;
}

export default function App() {
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [txs,     setTxs]     = useState<Transaction[]>([]);
  const [chain,   setChain]   = useState<ChainStats | null>(null);
  const [tab,     setTab]     = useState<Tab>("transactions");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, t, c] = await Promise.all([fetchStats(), fetchTransactions(), fetchChainStats()]);
      setStats(s);
      setTxs(t);
      setChain(c);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, background: "linear-gradient(90deg,#0052ff,#00c3ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            TraderAgent
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>AI swap agent · Base Network</p>
        </div>
        <button
          onClick={load}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
          <StatCard label="Onchain Swaps"    value={String(chain?.count ?? stats.totalSwaps)} />
          <StatCard label="Volume (USDC)"    value={`$${(chain?.volumeUSDC ?? stats.totalVolumeUSDC).toFixed(2)}`} />
          <StatCard label="Uptime"           value={formatUptime(stats.uptime)} />
          <StatCard label="Bot Address"      value={shortAddr(stats.botAddress)} small />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["transactions", "onchain"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)",
              background: tab === t ? "var(--blue)" : "var(--surface)",
              color: "var(--text)", cursor: "pointer", fontWeight: tab === t ? 700 : 400, fontSize: 13,
            }}
          >
            {t === "transactions" ? "Transactions" : "Onchain"}
          </button>
        ))}
      </div>

      {/* Transactions Tab */}
      {tab === "transactions" && (
        <TableWrap>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                <Th>Type</Th><Th>Tx Hash</Th><Th>Amount In</Th><Th>Amount Out</Th><Th>Time</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>No transactions yet</td></tr>
              )}
              {txs.map((tx, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td><TypeBadge type={tx.type} /></Td>
                  <Td><a href={basescanTx(tx.txHash)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontFamily: "monospace" }}>{shortAddr(tx.txHash)}</a></Td>
                  <Td>{tx.amountIn != null ? `${tx.amountIn} ${tx.tokenIn ?? ""}` : "—"}</Td>
                  <Td>{tx.amountOut != null ? `${tx.amountOut} ${tx.tokenOut ?? ""}` : "—"}</Td>
                  <Td style={{ color: "var(--muted)" }}>{fmt(tx.timestamp)}</Td>
                  <Td><StatusBadge status={tx.status} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {/* Onchain Tab */}
      {tab === "onchain" && (
        <TableWrap>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                <Th>User</Th><Th>USDC In</Th><Th>WETH Out</Th><Th>Tx Hash</Th><Th>Time</Th>
              </tr>
            </thead>
            <tbody>
              {(!chain || chain.recent.length === 0) && (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>No onchain swaps yet</td></tr>
              )}
              {chain?.recent.map((s, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td style={{ fontFamily: "monospace", fontSize: 12 }}>{shortAddr(s.user)}</Td>
                  <Td>${s.amountInUSDC.toFixed(2)}</Td>
                  <Td>{s.amountOutWETH.toFixed(6)}</Td>
                  <Td><a href={basescanTx(s.swapTxHash)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontFamily: "monospace" }}>{shortAddr(s.swapTxHash)}</a></Td>
                  <Td style={{ color: "var(--muted)" }}>{fmt(s.timestamp)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 24px" }}>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 24, fontWeight: 700, fontFamily: small ? "monospace" : undefined }}>{value}</div>
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "12px 16px", fontWeight: 500 }}>{children}</th>;
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "12px 16px", ...style }}>{children}</td>;
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    swap: "#0052ff", payment_received: "#4ade80", payment_sent: "#fbbf24",
  };
  return (
    <span style={{
      background: (colors[type] ?? "#64748b") + "22",
      color: colors[type] ?? "#64748b",
      padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
    }}>
      {type.replace("_", " ")}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = status === "confirmed" ? "var(--green)" : status === "failed" ? "var(--red)" : "var(--yellow)";
  return <span style={{ color: c, fontSize: 12 }}>{status}</span>;
}
