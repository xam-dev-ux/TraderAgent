# TraderAgent — Guía de despliegue

## Requisitos previos

- Node 20.x (`nvm use 20` o `.node-version` lo gestiona automáticamente)
- `cast` de Foundry instalado ([getfoundry.sh](https://getfoundry.sh))
- Cuenta en [Render](https://render.com) y [Vercel](https://vercel.com)
- Wallet personal (owner) con ~0.01 ETH en Base para pagar gas de despliegue

---

## Paso 1 — Crear la wallet bot

La wallet bot es efímera: solo firma transacciones XMTP y ejecuta swaps. Nunca toca contratos de ownership.

```bash
cast wallet new
```

Guarda la salida en un lugar seguro:

```
Address:     0xBOT_ADDRESS
Private key: 0xBOT_PRIVATE_KEY
```

Fondea la bot wallet con:
- ~0.005 ETH en Base (gas para swaps y registro onchain)
- Algo de USDC si quieres hacer pruebas de swap

---

## Paso 2 — Desplegar SwapRegistry en Base

```bash
cd packages/contracts
cp .env.example .env
```

Edita `.env` con tus valores reales:

```env
OWNER_PRIVATE_KEY=0x...   # tu wallet personal — la que despliega
OWNER_WALLET_ADDRESS=0x...
BOT_WALLET_ADDRESS=0x...  # la address del bot (no su private key)
BASE_RPC_URL=https://mainnet.base.org
```

Instala dependencias y despliega:

```bash
npm install
npx hardhat run scripts/deploy.ts --network base
```

Al terminar verás:
```
[deploy] owner: 0xOWNER...
[deploy] SwapRegistry: 0xCONTRACT...
[deploy] saved to deployments/base.json
```

Anota la dirección de `SwapRegistry` — la necesitarás en Render.

---

## Paso 3 — Desplegar el agente en Render

### Crear el Web Service

1. Ve a [render.com](https://render.com) → **New → Web Service**
2. Conecta tu repositorio
3. Configura:
   - **Root directory:** `packages/agent`
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Node version:** 20

### Variables de entorno en Render

Añade estas variables en **Environment → Environment Variables**:

| Variable | Valor |
|----------|-------|
| `BOT_PRIVATE_KEY` | `0x...` (la private key del bot) |
| `BOT_ADDRESS` | `0x...` (la address del bot) |
| `SWAP_REGISTRY_ADDRESS` | `0x...` (output del paso 2) |
| `BASE_RPC_URL` | `https://mainnet.base.org` |
| `PORT` | `3000` |
| `PRICE_PER_ANALYSIS` | `0.01` |
| `SWAP_FEE_USDC` | `0.02` |
| `MIN_SWAP_USDC` | `5` |
| `BOT_URL` | *(dejar vacío por ahora, se rellena en paso 5)* |
| `DASHBOARD_URL` | *(dejar vacío por ahora, se rellena en paso 6)* |
| `BUILDER_CODE` | *(opcional — tu código ERC-8021)* |

Haz clic en **Create Web Service** y espera a que el deploy termine.

Anota la URL del servicio: `https://trader-agent-xxxx.onrender.com`

### Verificar que arranca

```bash
curl https://trader-agent-xxxx.onrender.com/health
# → {"status":"ok","botAddress":"0x...","uptime":...}
```

---

## Paso 4 — Registrar en ERC-8004

Con el agente ya desplegado en Render, registra su identidad onchain desde la wallet owner.

Añade al `.env` de `packages/contracts`:

```env
AGENT_URL=https://trader-agent-xxxx.onrender.com
```

Ejecuta el script:

```bash
cd packages/contracts
npx hardhat run scripts/register8004.ts --network base
```

Al terminar verás:
```
[register] tx: 0x...
[register] confirmed in block XXXXXX
[register] ERC8004_AGENT_ID=42
```

Añade `ERC8004_AGENT_ID=42` a las variables de Render.

---

## Paso 5 — Actualizar BOT_URL en Render

Ve a Render → tu servicio → **Environment** y actualiza:

```
BOT_URL=https://trader-agent-xxxx.onrender.com
```

Guarda → Render redespliega automáticamente (tarda ~1 min).

---

## Paso 6 — Desplegar el dashboard en Vercel

```bash
cd packages/ui
```

### Opción A — Vercel CLI

```bash
npm install -g vercel
vercel --prod
```

Durante el setup, añade la variable de entorno:
```
VITE_AGENT_API_URL=https://trader-agent-xxxx.onrender.com
```

### Opción B — Vercel web

1. Ve a [vercel.com](https://vercel.com) → **New Project**
2. Importa tu repositorio
3. **Root directory:** `packages/ui`
4. **Framework:** Vite
5. Añade variable de entorno: `VITE_AGENT_API_URL=https://trader-agent-xxxx.onrender.com`
6. Despliega

Anota la URL del dashboard: `https://trader-agent-ui.vercel.app`

### Añadir DASHBOARD_URL a Render

Ve a Render → Environment y añade:

```
DASHBOARD_URL=https://trader-agent-ui.vercel.app
```

---

## Paso 7 — Verificar todo

```bash
# Health del agente
curl https://trader-agent-xxxx.onrender.com/health

# Stats del contrato onchain
curl https://trader-agent-xxxx.onrender.com/api/chain-stats

# Log de transacciones en memoria
curl https://trader-agent-xxxx.onrender.com/api/transactions
```

Abre la app de [Coinbase Wallet](https://www.coinbase.com/wallet) o cualquier cliente XMTP y envía un mensaje a la bot address:

```
help
```

Deberías recibir el menú de comandos.

---

## Rotar la wallet bot

Si necesitas cambiar la private key del bot (por seguridad o compromiso), no necesitas redesplegar el contrato:

```bash
# Genera una wallet nueva
cast wallet new

cd packages/contracts
# Llama a setAgent() desde la wallet owner
npx ts-node scripts/updateAgent.ts 0xNEW_BOT_ADDRESS
```

Luego actualiza `BOT_PRIVATE_KEY` y `BOT_ADDRESS` en Render.

---

## Comandos disponibles en el chat XMTP

| Comando | Coste | Descripción |
|---------|-------|-------------|
| `help` | gratis | Menú de comandos |
| `price eth` | gratis | Precio live de ETH, BTC, SOL, DOGE |
| `balance` | gratis | USDC + ETH de la wallet bot |
| `history` | gratis | Tus últimos 5 swaps onchain |
| `analyze eth` | $0.01 USDC | Análisis técnico (tendencia, soporte, resistencia) |
| `swap 10 usdc` | $10.02 USDC | Swap USDC→ETH vía Uniswap V3 en Base |

---

## Notas de seguridad

- `OWNER_PRIVATE_KEY` **solo existe en tu máquina local** (`packages/contracts/.env`). Nunca en Render, nunca en git.
- `BOT_PRIVATE_KEY` solo en Render como variable de entorno secreta. Nunca en git.
- El `.gitignore` ya excluye `.env` y `deployments/`.
- `amountOutMinimum: 0n` en el swap = sin protección de slippage. Para producción considera calcular el mínimo con el Uniswap V3 Quoter y aplicar 1% de tolerancia.
- El keep-alive de 10 min previene el sleep del free tier de Render mientras `BOT_URL` esté configurado.
