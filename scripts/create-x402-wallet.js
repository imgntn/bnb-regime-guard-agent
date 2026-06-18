#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");

const env = readEnv();
let privateKey = env.X402_PRIVATE_KEY;
let created = false;

if (!privateKey) {
  privateKey = generatePrivateKey();
  env.X402_PRIVATE_KEY = privateKey;
  created = true;
}

const account = privateKeyToAccount(privateKey);
env.X402_WALLET_ADDRESS = account.address;
env.CMC_USE_X402 = "1";
env.CMC_X402_TRANSPORT = env.CMC_X402_TRANSPORT || "quotes";
env.CMC_X402_FALLBACK = env.CMC_X402_FALLBACK || "1";
env.X402_NETWORK = env.X402_NETWORK || "eip155:8453";
env.X402_MAX_USDC_PER_REQUEST = env.X402_MAX_USDC_PER_REQUEST || "0.02";

writeEnv(env);

process.stdout.write(JSON.stringify({
  created,
  address: account.address,
  chain: "Base mainnet",
  minimumFunding: {
    USDC: "1.00",
    ETH: "0.001"
  },
  recommendedFunding: {
    USDC: "2.00",
    ETH: "0.002"
  },
  note: "Private key saved only in ignored local .env as X402_PRIVATE_KEY. Do not commit or paste it."
}, null, 2) + "\n");

function readEnv() {
  const values = {};
  if (!fs.existsSync(ENV_PATH)) return values;
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    values[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
  }
  return values;
}

function writeEnv(values) {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
    : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const equals = line.indexOf("=");
    if (equals === -1 || line.trim().startsWith("#")) return line;
    const key = line.slice(0, equals);
    if (!(key in values)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_PATH, next.filter((line, index, all) => line !== "" || index < all.length - 1).join("\n") + "\n");
}
