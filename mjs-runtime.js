import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function registerShutdown(onShutdown, options = {}) {
  const signals = Array.isArray(options.signals) ? options.signals : ["SIGINT", "SIGTERM"];
  const onError =
    typeof options.onError === "function"
      ? options.onError
      : (error) => {
          console.error(error);
          process.exit(1);
        };

  let shuttingDown = false;

  for (const signal of signals) {
    process.on(signal, () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      Promise.resolve(onShutdown(signal)).catch(onError);
    });
  }
}
