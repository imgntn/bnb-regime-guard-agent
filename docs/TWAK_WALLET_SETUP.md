# TWAK Wallet Setup

Track 1 needs two separate things:

- **TWAK API credentials**: `TWAK_ACCESS_ID` and `TWAK_HMAC_SECRET` authenticate CLI/API requests to Trust Wallet Agent Kit.
- **A local TWAK agent wallet**: this is the self-custody wallet that signs BSC registration and trade transactions.

Do not commit `.env`, wallet files, wallet passwords, private keys, or seed phrases.

## 1. Add Local TWAK Credentials

Create a local `.env` file in the repo root:

```powershell
cd C:\Users\James Pollack\Desktop\imgntn_repos\bnb-regime-guard-agent
Copy-Item .env.example .env
notepad .env
```

Set these values in `.env`:

```text
TWAK_ACCESS_ID=your-access-id
TWAK_HMAC_SECRET=your-hmac-secret
```

The agent also accepts the alias names `TW_ACCESS_ID` and `TW_HMAC_SECRET`, but the canonical names above are preferred.

## 2. Check TWAK Auth

```powershell
npm run doctor
```

Expected progress:

- `twakAuth.configured` should become `true`.
- `twakWallet.agentWallet` may still say `not configured` until the next step.

## 3. Create A Local Agent Wallet

Use a strong password and keep it out of git:

```powershell
npx -y @trustwallet/cli init
npx -y @trustwallet/cli wallet create --password "choose-a-strong-local-password"
```

Then check status again:

```powershell
npm run doctor
```

Expected progress:

- `twakWallet.agentWallet` should show an address.
- `twakWallet.keychainPassword` should show that the password is stored or available.

## 4. Fund The Wallet

Fund the TWAK agent wallet on BSC before the Track 1 trading window.

Minimum practical funding:

- BNB for gas.
- A small non-zero balance of in-scope competition assets.
- Stable funds such as USDT, USDC, or FDUSD if the agent will rotate from stables.

The default policy keeps trades small:

```text
MAX_USD_PER_TRADE=5
MAX_DAILY_TRADES=1
SLIPPAGE_PCT=0.75
```

## 5. Register For BNB Hack Track 1

Registration is an on-chain transaction. Run it only after the wallet exists and is funded for gas:

```powershell
npm run compete:status
npm run register
```

Save these for the DoraHacks Track 1 submission:

- Agent wallet address.
- Registration transaction hash.

## 6. Dry Run Before Live Trading

```powershell
npm run analyze
npm run once:dry
```

Dry run should produce:

- market regime
- ranked signals
- proposed swap intent
- TWAK quote if auth/wallet are configured

## 7. Live Trading

Live trading is intentionally blocked unless both flags are set:

```powershell
$env:LIVE_TRADING='1'
$env:TWAK_CONFIRM_LIVE='I_ACCEPT_LIVE_TRADING_RISK'
$env:MAX_USD_PER_TRADE='5'
npm run once:live
```

For Git Bash:

```bash
LIVE_TRADING=1 TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK MAX_USD_PER_TRADE=5 npm run once:live
```

Save the first successful BSC trade transaction hash for DoraHacks.

## 8. Security Notes

- Rotate TWAK credentials if they were ever pasted into chat, logs, screenshots, or issue trackers.
- Never put TWAK wallet passwords, private keys, or mnemonics into GitHub Actions.
- Keep live trading local unless you intentionally choose a server deployment model.
- Start with the smallest practical `MAX_USD_PER_TRADE`.

