import http from "http";
import { randomUUID } from "crypto";
import { Client, type Signer, IdentifierKind } from "@xmtp/node-sdk";
import { keccak256, toBytes } from "viem";
import { account, publicClient, builderDataSuffix } from "./wallet.js";
import {
  PORT, BOT_ADDRESS, BOT_URL, DASHBOARD_URL,
  SWAP_FEE_USDC, PRICE_PER_ANALYSIS, MIN_SWAP_USDC,
} from "./constants.js";
import { parseIntent } from "./handler.js";
import { getPrice } from "./prices.js";
import { executeSwap } from "./swap.js";
import { build402Header, settleX402Payment } from "./x402.js";
import { buildPayPage } from "./payPage.js";
import { getTransactions } from "./transactions.js";
import { getOnChainStats, getUserSwaps } from "./swapRegistry.js";

const startTime = Date.now();

type PendingPayment = {
  type: "analysis" | "swap";
  token?: string;
  amount?: number;
  userAddress: `0x${string}`;
  send: (text: string) => Promise<unknown>;
  expiresAt: number;
};

type PaymentStatus = {
  status: "processing" | "done" | "failed";
  swapTxHash?: string;
  error?: string;
};

const pendingPayments = new Map<string, PendingPayment>();
const paymentStatus   = new Map<string, PaymentStatus>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Payment");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function runAnalysis(token: string): Promise<string> {
  try {
    const price = await getPrice(token);
    const change = price.usd_24h_change;
    const trend  = change > 2 ? "bullish" : change < -2 ? "bearish" : "neutral";
    return [
      `📊 Technical Analysis: ${token.toUpperCase()}`,
      `   Price: $${price.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `   24h change: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
      `   Trend: ${trend}`,
      `   Support: $${(price.usd * 0.95).toFixed(2)} | Resistance: $${(price.usd * 1.05).toFixed(2)}`,
    ].join("\n");
  } catch {
    return `Could not fetch analysis for ${token.toUpperCase()}.`;
  }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  const url      = new URL(req.url ?? "/", `http://localhost`);
  const pathname = url.pathname;

  // GET /health
  if (pathname === "/health" && req.method === "GET") {
    return json(res, {
      status: "ok",
      botAddress: BOT_ADDRESS,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  }

  // GET /api/transactions
  if (pathname === "/api/transactions" && req.method === "GET") {
    return json(res, getTransactions());
  }

  // GET /api/stats
  if (pathname === "/api/stats" && req.method === "GET") {
    const chainStats = await getOnChainStats().catch(() => ({ count: 0, volumeUSDC: 0, recent: [] }));
    return json(res, {
      totalSwaps:     chainStats.count,
      totalVolumeUSDC: chainStats.volumeUSDC,
      uptime:         Math.floor((Date.now() - startTime) / 1000),
      botAddress:     BOT_ADDRESS,
    });
  }

  // GET /api/chain-stats
  if (pathname === "/api/chain-stats" && req.method === "GET") {
    const stats = await getOnChainStats().catch(() => ({ count: 0, volumeUSDC: 0, recent: [] }));
    return json(res, stats);
  }

  // GET /api/payment-status/:nonce
  const statusMatch = pathname.match(/^\/api\/payment-status\/(.+)$/);
  if (statusMatch && req.method === "GET") {
    const status = paymentStatus.get(statusMatch[1]);
    if (!status) return json(res, { status: "not_found" }, 404);
    return json(res, status);
  }

  // POST /api/confirm-payment
  if (pathname === "/api/confirm-payment" && req.method === "POST") {
    const raw  = await readBody(req);
    const { txHash, nonce, userAddress } = JSON.parse(raw);

    paymentStatus.set(nonce, { status: "processing" });
    json(res, { status: "processing", txHash });

    (async () => {
      console.log(`[confirm-payment] nonce=${nonce} txHash=${txHash}`);

      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as `0x${string}`, timeout: 120_000,
        });
      } catch (err) {
        console.error(`[confirm-payment] waitForReceipt failed: ${(err as Error).message}`);
        paymentStatus.set(nonce, { status: "failed", error: "Could not confirm transaction on-chain" });
        return;
      }

      if (receipt.status !== "success") {
        paymentStatus.set(nonce, { status: "failed", error: "Transaction reverted" });
        pendingPayments.get(nonce)?.send("❌ Payment reverted.").catch(() => {});
        pendingPayments.delete(nonce);
        return;
      }

      const pending = pendingPayments.get(nonce);
      if (!pending) {
        console.error(`[confirm-payment] no pending entry for nonce=${nonce} (server restart?)`);
        paymentStatus.set(nonce, { status: "failed", error: "Payment session expired — please start a new request in chat." });
        return;
      }

      console.log(`[confirm-payment] executing type=${pending.type}`);

      if (pending.type === "swap") {
        try {
          const { swapTxHash, amountOut } = await executeSwap(pending.amount!, userAddress as `0x${string}`);
          paymentStatus.set(nonce, { status: "done", swapTxHash });
          await pending.send([
            `✅ Swap executed!`,
            `   ${pending.amount} USDC → ${(Number(amountOut) / 1e18).toFixed(6)} WETH`,
            `   https://basescan.org/tx/${swapTxHash}`,
          ].join("\n"));
        } catch (err) {
          paymentStatus.set(nonce, { status: "failed", error: (err as Error).message });
          await pending.send(`❌ Swap failed: ${(err as Error).message}`);
        }
      } else if (pending.type === "analysis") {
        const result = await runAnalysis(pending.token!);
        paymentStatus.set(nonce, { status: "done" });
        await pending.send(result).catch((e: unknown) => console.error("[confirm-payment] xmtp send failed:", e));
      }

      pendingPayments.delete(nonce);
    })().catch((err: unknown) => {
      console.error(`[confirm-payment] unhandled error:`, err);
      paymentStatus.set(nonce, { status: "failed", error: "Internal server error" });
    });
    return;
  }

  // GET /api/swap/:amount?nonce=
  const swapMatch = pathname.match(/^\/api\/swap\/([\d.]+)$/);
  if (swapMatch && req.method === "GET") {
    const amount   = Number(swapMatch[1]);
    const nonce    = url.searchParams.get("nonce") ?? "";
    const xPayment = req.headers["x-payment"] as string | undefined;
    const totalCost = amount + SWAP_FEE_USDC;

    if (!xPayment && req.headers.accept?.includes("text/html")) {
      cors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildPayPage(totalCost, `Swap ${amount} USDC → ETH`, BOT_ADDRESS, nonce, builderDataSuffix));
      return;
    }

    if (!xPayment) {
      const header402 = build402Header(totalCost, BOT_ADDRESS, `Swap ${amount} USDC → ETH`);
      cors(res);
      res.writeHead(402, {
        "Content-Type": "application/json",
        "X-PAYMENT-REQUIRED": header402,
      });
      res.end(JSON.stringify({ error: "Payment required", amountUSDC: totalCost }));
      return;
    }

    try {
      const settled = await settleX402Payment(xPayment);
      console.log(`[x402] swap settled from=${settled.userAddress} tx=${settled.txHash}`);

      const { swapTxHash, amountOut } = await executeSwap(amount, settled.userAddress);
      const resultText = [
        `✅ Swap executed!`,
        `   ${amount} USDC → ${(Number(amountOut) / 1e18).toFixed(6)} WETH`,
        `   https://basescan.org/tx/${swapTxHash}`,
      ].join("\n");

      const pending = pendingPayments.get(nonce);
      if (pending) {
        pending.send(resultText).catch((e) => console.error("[x402] xmtp notify:", e));
        paymentStatus.set(nonce, { status: "done", swapTxHash });
        pendingPayments.delete(nonce);
      }

      return json(res, { swapTxHash, paymentTxHash: settled.txHash, amountOut: Number(amountOut) });
    } catch (err) {
      console.error("[x402] swap error:", err);
      const pending = pendingPayments.get(nonce);
      if (pending) {
        pending.send(`❌ Swap failed: ${(err as Error).message}`).catch(() => {});
        paymentStatus.set(nonce, { status: "failed", error: (err as Error).message });
        pendingPayments.delete(nonce);
      }
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET /api/analyze/:token?nonce=
  const analyzeMatch = pathname.match(/^\/api\/analyze\/([a-z]+)$/);
  if (analyzeMatch && req.method === "GET") {
    const token    = analyzeMatch[1];
    const nonce    = url.searchParams.get("nonce") ?? "";
    const xPayment = req.headers["x-payment"] as string | undefined;

    if (!xPayment && req.headers.accept?.includes("text/html")) {
      cors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildPayPage(PRICE_PER_ANALYSIS, `Analysis of ${token.toUpperCase()}`, BOT_ADDRESS, nonce, builderDataSuffix));
      return;
    }

    if (!xPayment) {
      cors(res);
      res.writeHead(402, {
        "Content-Type": "application/json",
        "X-PAYMENT-REQUIRED": build402Header(PRICE_PER_ANALYSIS, BOT_ADDRESS, `Analysis of ${token.toUpperCase()}`),
      });
      res.end(JSON.stringify({ error: "Payment required", amountUSDC: PRICE_PER_ANALYSIS }));
      return;
    }

    try {
      const settled = await settleX402Payment(xPayment);
      const result  = await runAnalysis(token);
      const pending = pendingPayments.get(nonce);
      if (pending) {
        pending.send(result).catch((e) => console.error("[x402] xmtp notify:", e));
        paymentStatus.set(nonce, { status: "done" });
        pendingPayments.delete(nonce);
      }
      return json(res, { analysis: result, txHash: settled.txHash });
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  json(res, { error: "Not found" }, 404);
});

server.listen(PORT, () => console.log(`[http] listening on port ${PORT}`));

// ── XMTP Listener ─────────────────────────────────────────────────────────────

async function startXmtp() {
  const privateKey = process.env.BOT_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) { console.warn("[xmtp] BOT_PRIVATE_KEY not set, skipping XMTP"); return; }

  const dbKey = keccak256(toBytes(privateKey));

  const signer: Signer = {
    type: "EOA",
    getIdentifier: () => ({ identifier: account.address.toLowerCase(), identifierKind: IdentifierKind.Ethereum }),
    signMessage: async (message: string) => {
      const sig = await account.signMessage({ message });
      return toBytes(sig);
    },
  };

  const client = await Client.create(signer, {
    dbEncryptionKey: toBytes(dbKey),
    env: "production",
  });

  console.log(`[xmtp] bot address: ${account.address}`);
  await client.conversations.sync();

  const helpText = `TraderAgent

Commands:
  price eth       — live ETH price (free)
  analyze eth     — technical analysis ($0.01)
  swap 10 usdc    — swap USDC→ETH ($0.02 fee)
  balance         — bot wallet balance
  history         — your swap history (onchain)
  help            — this message

Swaps are recorded onchain on Base via SwapRegistry.${DASHBOARD_URL ? `\nView dashboard: ${DASHBOARD_URL}` : ""}`;

  const stream = await client.conversations.streamAllMessages();
  for await (const message of stream) {
    if (!message || message.senderInboxId === client.inboxId) continue;
    const text    = typeof message.content === "string" ? message.content : "";
    if (!text) continue;

    const conversation = await client.conversations.getConversationById(message.conversationId);
    if (!conversation) continue;

    const send = (t: string) => conversation.send(t);
    const intent = parseIntent(text);

    // Derive sender address from inboxId (use as identifier)
    const senderAddr = message.senderInboxId as `0x${string}`;

    if (intent.type === "help") {
      await send(helpText);

    } else if (intent.type === "price") {
      try {
        const price = await getPrice(intent.token);
        const sign  = price.usd_24h_change >= 0 ? "+" : "";
        await send(
          `${intent.token.toUpperCase()} price: $${price.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${sign}${price.usd_24h_change.toFixed(2)}% 24h)`
        );
      } catch {
        await send(`Could not fetch price for ${intent.token.toUpperCase()}.`);
      }

    } else if (intent.type === "balance") {
      try {
        const ETH_BAL_ABI = [{
          name: "balanceOf", type: "function", stateMutability: "view",
          inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }],
        }] as const;
        const [ethRaw, usdcRaw] = await Promise.all([
          publicClient.getBalance({ address: account.address }),
          publicClient.readContract({
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            abi: ETH_BAL_ABI, functionName: "balanceOf", args: [account.address],
          }),
        ]);
        await send(
          `Bot wallet balance:\n  ETH:  ${(Number(ethRaw) / 1e18).toFixed(6)}\n  USDC: ${(Number(usdcRaw) / 1e6).toFixed(2)}`
        );
      } catch {
        await send("Could not fetch balance.");
      }

    } else if (intent.type === "history") {
      try {
        const swaps = await getUserSwaps(senderAddr);
        if (!swaps.length) {
          await send("No swaps found onchain for your address.");
        } else {
          const lines = swaps.map((s, i) =>
            `${i + 1}. ${s.amountInUSDC.toFixed(2)} USDC → ${s.amountOutWETH.toFixed(6)} WETH | https://basescan.org/tx/${s.swapTxHash}`
          );
          await send(`Your last ${swaps.length} swap(s):\n${lines.join("\n")}`);
        }
      } catch {
        await send("Could not fetch swap history.");
      }

    } else if (intent.type === "analysis") {
      const nonce = randomUUID();
      pendingPayments.set(nonce, {
        type: "analysis", token: intent.token,
        userAddress: senderAddr,
        send, expiresAt: Date.now() + 30 * 60 * 1000,
      });
      await send(
        `Analysis of ${intent.token.toUpperCase()} costs $${PRICE_PER_ANALYSIS} USDC.\nPay here: ${BOT_URL}/api/analyze/${intent.token}?nonce=${nonce}`
      );

    } else if (intent.type === "swap") {
      if (intent.amount < MIN_SWAP_USDC) {
        await send(`Minimum swap is $${MIN_SWAP_USDC} USDC.`);
        continue;
      }
      const total = intent.amount + SWAP_FEE_USDC;
      const nonce = randomUUID();
      pendingPayments.set(nonce, {
        type: "swap", amount: intent.amount,
        userAddress: senderAddr,
        send, expiresAt: Date.now() + 30 * 60 * 1000,
      });
      await send(
        `Swap ${intent.amount} USDC → ETH costs $${total} USDC (includes $${SWAP_FEE_USDC} fee).\nPay here: ${BOT_URL}/api/swap/${intent.amount}?nonce=${nonce}`
      );

    } else {
      await send(`I didn't understand that. Type "help" for available commands.`);
    }
  }
}

// Keep-alive to prevent Render free tier sleep
if (BOT_URL) {
  setInterval(() => fetch(`${BOT_URL}/health`).catch(() => {}), 10 * 60 * 1000);
}

startXmtp().catch(console.error);
