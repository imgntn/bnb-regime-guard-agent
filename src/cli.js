#!/usr/bin/env node
import { analyze, doctor, latestEvidence, markShadowTrade, openShadowTrade, recordShadowTick, runOnce, runShadowMonitor, scanShadowCandidates } from "./agent.js";
import { twak } from "./twak.js";

function print(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === "help") {
    print({
      commands: ["doctor", "analyze", "run --dry-run", "run --live", "evidence", "shadow-open", "shadow-mark", "shadow-scan", "shadow-tick", "shadow-monitor", "loop --dry-run", "compete-status", "register"],
      note: "Live mode requires LIVE_TRADING=1 and TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK."
    });
    return 0;
  }

  if (command === "doctor") {
    print(await doctor());
    return 0;
  }
  if (command === "analyze") {
    print(await analyze());
    return 0;
  }
  if (command === "run") {
    print(await runOnce({ live: args.includes("--live") }));
    return 0;
  }
  if (command === "evidence") {
    print(latestEvidence());
    return 0;
  }
  if (command === "shadow-open") {
    print(await openShadowTrade());
    return 0;
  }
  if (command === "shadow-mark") {
    print(await markShadowTrade());
    return 0;
  }
  if (command === "shadow-scan") {
    print(await scanShadowCandidates());
    return 0;
  }
  if (command === "shadow-tick") {
    print(await recordShadowTick());
    return 0;
  }
  if (command === "shadow-monitor") {
    await runShadowMonitor({ intervalMs: Number(process.env.AGENT_SHADOW_INTERVAL_MS ?? 15 * 60 * 1000) });
    return 0;
  }
  if (command === "loop") {
    const live = args.includes("--live");
    const intervalMs = Number(process.env.AGENT_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
    do {
      print(await runOnce({ live }));
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (true);
  }
  if (command === "compete-status") {
    print(await twak.competeStatus());
    return 0;
  }
  if (command === "register") {
    print(await twak.competeRegister());
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
