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
- Enforces trade size, daily trade count, slippage, allowlist, and regime gates.
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
```

This is useful for measuring spread, slippage, candidate routing cost, and short-term signal behavior before enabling live mode.

Live and dry-run selection use the same route-aware policy:

- Candidate must be a `ROTATE_IN` signal above the confidence threshold.
- TWAK must quote both entry and reverse mark routes.
- Immediate round-trip drag must stay below `maxRoundTripDragPct`.
- Final choice is ranked by strategy score minus route-drag penalty.

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
npm run once:live
```

For Git Bash:

```bash
LIVE_TRADING=1 TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK MAX_USD_PER_TRADE=5 npm run once:live
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
