import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function commandParts() {
  if (process.env.TWAK_BIN) {
    return { command: process.env.TWAK_BIN, prefix: [], needsShell: false };
  }
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    prefix: ["-y", "@trustwallet/cli"],
    needsShell: process.platform === "win32"
  };
}

export async function runTwak(args, { json = true, timeoutMs = 120000 } = {}) {
  const { command, prefix, needsShell } = commandParts();
  const finalArgs = [...prefix, ...args, ...(json && !args.includes("--json") ? ["--json"] : [])];
  try {
    const { stdout, stderr } = await execFileAsync(command, finalArgs, {
      timeout: timeoutMs,
      shell: needsShell,
      windowsHide: true,
      env: process.env
    });
    const text = stdout.trim();
    return json && text ? JSON.parse(text) : { stdout: text, stderr: stderr.trim() };
  } catch (error) {
    const stdout = String(error.stdout ?? "").trim();
    let parsed;
    try {
      parsed = stdout ? JSON.parse(stdout) : undefined;
    } catch {
      parsed = undefined;
    }
    const message = parsed?.error ?? error.message;
    const wrapped = new Error(message);
    wrapped.code = parsed?.errorCode ?? error.code;
    wrapped.stdout = stdout;
    wrapped.stderr = String(error.stderr ?? "").trim();
    throw wrapped;
  }
}

export const twak = {
  authStatus: () => runTwak(["auth", "status"]),
  walletStatus: () => runTwak(["wallet", "status"]),
  competeStatus: () => runTwak(["compete", "status"]),
  competeRegister: () => runTwak(["compete", "register"], { timeoutMs: 180000 }),
  quoteSwap: ({ usdAmount, fromSymbol, toSymbol, fromAssetId, toAssetId, chain, slippagePct }) =>
    runTwak([
      "swap",
      fromAssetId ?? fromSymbol,
      toAssetId ?? toSymbol,
      "--chain",
      chain,
      "--usd",
      String(usdAmount),
      "--slippage",
      String(slippagePct),
      "--quote-only"
    ]),
  quoteExactSwap: ({ amount, fromSymbol, toSymbol, fromAssetId, toAssetId, chain, slippagePct }) =>
    runTwak([
      "swap",
      String(amount),
      fromAssetId ?? fromSymbol,
      toAssetId ?? toSymbol,
      "--chain",
      chain,
      "--slippage",
      String(slippagePct),
      "--quote-only"
    ]),
  executeSwap: ({ usdAmount, fromSymbol, toSymbol, fromAssetId, toAssetId, chain, slippagePct }) =>
    runTwak([
      "swap",
      fromAssetId ?? fromSymbol,
      toAssetId ?? toSymbol,
      "--chain",
      chain,
      "--usd",
      String(usdAmount),
      "--slippage",
      String(slippagePct)
    ], { timeoutMs: 180000 })
};
