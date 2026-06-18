# Regime Guard TWAK Agent

![Regime Guard TWAK Agent logo](docs/assets/regime-guard-agent-logo-480.png)

Track 1 entry for **BNB Hack: AI Trading Agent Edition - CoinMarketCap x Trust Wallet**.

Regime Guard TWAK Agent is the live-execution version of the Regime Guard strategy. It reads CoinMarketCap market data, classifies the market regime, selects one BNB Chain rotation candidate, quotes the swap through Trust Wallet Agent Kit, records an evidence receipt, and only executes when explicit live-trading guardrails are enabled.

## What It Does

- Reads CoinMarketCap data through Agent Hub x402 MCP or REST, with sample fallback for reproducible demos.
- Generates deterministic `ROTATE_IN`, `HOLD`, `REDUCE`, and `AVOID` signals.
- Builds one guarded daily TWAK swap intent on BSC.
- Re-quotes candidate routes and penalizes high round-trip drag before selecting a trade.
- Uses `twak swap --quote-only` before every possible execution.
- Enforces trade size, daily trade floor/cap, slippage, allowlist, and regime gates.
- Tracks the live position it opened and can exit on risk-off, stop-loss, take-profit, or stale-position conditions.
- Writes decision receipts with hashes of the data snapshot, policy, report, intent, TWAK quote, and live tx result.
- Registers the agent wallet for the BNB Hack competition through `twak compete register`.
- Includes a public agent card for BNB Agent SDK ERC-8004 identity registration.

## Why It Fits Track 1

The agent separates decision logic from signing authority. CMC Agent Hub data drives the signal, BNB Agent SDK metadata identifies the agent, and TWAK remains the execution layer. Private keys and wallet passwords are never committed to the repo; live swaps only run when local TWAK credentials and explicit live-trading environment flags are present.

## Quickstart

```bash
npm install
npm test
npm run agent-card
npm run x402:wallet
npm run analyze
npm run once:dry
npm run evidence
```

`npm run once:dry` quotes the proposed swap through TWAK when TWAK is configured. Without CMC credentials, `npm run analyze` uses `data/sample-market-snapshot.json`.

## Agent Hub And x402

Set `CMC_USE_X402=1` to make the data layer call the CoinMarketCap x402 quotes endpoint before strategy evaluation. If the local environment does not have x402 payment transport available, the agent records the x402 payment requirement in the decision receipt and falls back to the reproducible sample data when `CMC_X402_FALLBACK=1`. The MCP endpoint is also configurable with `CMC_X402_TRANSPORT=mcp`.

```bash
npm run x402:wallet
npm run x402:status
set CMC_USE_X402=1
set CMC_X402_QUOTES_URL=https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest
npm run once:dry
```

`npm run x402:wallet` creates a separate Base payment wallet, writes its private key only to ignored local `.env`, and prints the public address to fund. The default per-request cap is `X402_MAX_USDC_PER_REQUEST=0.02`.

The decision receipt includes `dataAccess.mode`, `endpoint`, `tool`, and `paymentRequired` when applicable.

## Shadow Trading

Shadow trading records the quote the agent would have taken and later marks that virtual position back to the stable asset. It does not move funds.

```bash
npm run shadow:open
npm run shadow:mark
npm run shadow:scan
npm run shadow:tick
```

This is useful for measuring spread, slippage, candidate routing cost, and short-term signal behavior before enabling live mode.

Live and dry-run selection use the same route-aware policy:

- Candidate must be a `ROTATE_IN` signal above the confidence threshold.
- TWAK must quote both entry and reverse mark routes.
- Immediate round-trip drag must stay below `maxRoundTripDragPct`.
- Profitability checklist must not fail hard conditions such as weak regime, overheated RSI, crowded funding, weak liquidity, or excessive route drag.
- Final choice is ranked by strategy score minus route-drag penalty.

To keep a local quote/PnL history, run `npm run shadow:tick`. It appends a timestamped mark and scan to ignored local state at `state/shadow-monitor.jsonl`.

## Competition Controls

Track 1 ranking is driven by live PnL, but qualification also depends on registered on-chain execution, eligible assets, non-dust capital, minimum trade count, and staying inside the drawdown gate. The agent is tuned for those constraints:

- It only builds swaps where both input and output symbols are in the competition allowlist.
- It allows up to two trades per day so one trade can satisfy the daily floor while a second can exit risk if needed.
- If no high-conviction asset passes the route and profitability checks, it can attempt a small stable-to-stable qualification swap instead of forcing a volatile entry.
- In competition mode, high-conviction signals can scale from `MAX_USD_PER_TRADE` up to `COMPETITION_MAX_USD_PER_TRADE` while still respecting the same route and drawdown gates.
- Open live positions are marked through a reverse TWAK quote before new entries; the agent exits on risk-off, `POSITION_STOP_LOSS_PCT`, `TAKE_PROFIT_PCT`, or `MAX_POSITION_HOLD_HOURS`.
- The default trade size is intentionally small until the wallet is funded and registered.

## Evidence Receipts

Every run appends a local receipt to `state/evidence-ledger.jsonl` and writes the latest receipt to `state/latest-decision-receipt.json`.

```bash
npm run once:dry
npm run evidence
```

See `docs/EVIDENCE_LEDGER.md` for the receipt fields. The ledger is local and ignored by git; the public metadata file is `docs/agent-card.json`.

## TWAK Setup

Detailed wallet setup is in `docs/TWAK_WALLET_SETUP.md`.

Install or use the CLI through `npx`:

```bash
npm install -g @trustwallet/cli
twak auth status --json
twak wallet status --json
```

If not configured, get Trust Wallet Agent Kit credentials from `https://portal.trustwallet.com`, set them as environment variables, and run:

```bash
twak init
twak wallet create --password "use-a-strong-local-password"
```

The agent also loads a local `.env` file. Use `TWAK_ACCESS_ID` and `TWAK_HMAC_SECRET`; `TW_ACCESS_ID` and `TW_HMAC_SECRET` are accepted as aliases.

Do not commit `.env`, wallet files, mnemonics, or private keys.

## Competition Registration

Registration is an on-chain transaction on BSC against the official competition registry. Check status first:

```bash
npm run compete:status
npm run register
```

Successful registration returns the agent wallet address and transaction hash. Submit that wallet address on DoraHacks.

## Live Mode

Dry run is the default. To execute a single guarded live swap:

```bash
set COMPETITION_MODE=1
set LIVE_TRADING=1
set TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK
set MAX_USD_PER_TRADE=5
set COMPETITION_MAX_USD_PER_TRADE=8
set MAX_DAILY_TRADES=2
npm run once:live
```

For Git Bash:

```bash
COMPETITION_MODE=1 LIVE_TRADING=1 TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK MAX_USD_PER_TRADE=5 COMPETITION_MAX_USD_PER_TRADE=8 MAX_DAILY_TRADES=2 npm run once:live
```

The live path refuses to run without both live flags. This is intentional.

## Optional BNB Agent SDK Identity

Generate the public agent card first:

```bash
npm run agent-card
```

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install bnbagent
python scripts/register-bnb-agent.py
```

This registers an ERC-8004 agent identity with the generated agent card endpoint. It is separate from the BNB Hack competition wallet registration.

## Disclaimer

This is hackathon software, not financial advice. Live trading can lose money.
