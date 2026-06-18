# Regime Guard TWAK Agent

![Regime Guard TWAK Agent logo](docs/assets/regime-guard-agent-logo-480.png)

Track 1 entry for **BNB Hack: AI Trading Agent Edition - CoinMarketCap x Trust Wallet**.

Regime Guard TWAK Agent is the live-execution version of the Regime Guard strategy. It reads CoinMarketCap market data, classifies the market regime, selects one BNB Chain rotation candidate, quotes the swap through Trust Wallet Agent Kit, and only executes when explicit live-trading guardrails are enabled.

## What It Does

- Reads CoinMarketCap data through REST, with sample fallback for reproducible demos.
- Generates deterministic `ROTATE_IN`, `HOLD`, `REDUCE`, and `AVOID` signals.
- Builds one guarded daily TWAK swap intent on BSC.
- Re-quotes candidate routes and penalizes high round-trip drag before selecting a trade.
- Uses `twak swap --quote-only` before every possible execution.
- Enforces trade size, daily trade floor/cap, slippage, allowlist, and regime gates.
- Tracks the live position it opened and can exit on risk-off, stop-loss, take-profit, or stale-position conditions.
- Registers the agent wallet for the BNB Hack competition through `twak compete register`.
- Includes optional BNB Agent SDK ERC-8004 identity registration.

## Why It Fits Track 1

The agent separates decision logic from signing authority. CMC data drives the signal, but TWAK remains the execution layer. Private keys and wallet passwords are never committed to the repo; live swaps only run when local TWAK credentials and explicit live-trading environment flags are present.

## Quickstart

```bash
npm install
npm test
npm run analyze
npm run once:dry
```

`npm run once:dry` quotes the proposed swap through TWAK when TWAK is configured. Without CMC credentials, `npm run analyze` uses `data/sample-market-snapshot.json`.

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
- Open live positions are marked through a reverse TWAK quote before new entries; the agent exits on risk-off, `POSITION_STOP_LOSS_PCT`, `TAKE_PROFIT_PCT`, or `MAX_POSITION_HOLD_HOURS`.
- The default trade size is intentionally small until the wallet is funded and registered.

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
set LIVE_TRADING=1
set TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK
set MAX_USD_PER_TRADE=5
set MAX_DAILY_TRADES=2
npm run once:live
```

For Git Bash:

```bash
LIVE_TRADING=1 TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK MAX_USD_PER_TRADE=5 MAX_DAILY_TRADES=2 npm run once:live
```

The live path refuses to run without both live flags. This is intentional.

## Optional BNB Agent SDK Identity

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install bnbagent
python scripts/register-bnb-agent.py
```

This registers an ERC-8004 agent identity. It is separate from the BNB Hack competition wallet registration.

## Disclaimer

This is hackathon software, not financial advice. Live trading can lose money.
