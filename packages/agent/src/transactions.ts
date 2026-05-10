import fs from "fs";
const LOG_FILE = "/tmp/traderagent-txlog.json";

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

let _log: Transaction[] = [];
try { _log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch {}

export function logTransaction(tx: Transaction): void {
  _log.unshift(tx);
  if (_log.length > 200) _log.length = 200;
  fs.writeFileSync(LOG_FILE, JSON.stringify(_log));
}

export function getTransactions(): Transaction[] { return _log; }
