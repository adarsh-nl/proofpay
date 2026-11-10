/**
 * Minimal .env loader for maintenance scripts (`db:reset`, `paypal-smoke`).
 * The Next.js runtime loads `.env.local` itself; plain `tsx` scripts do not.
 * Never prints values.
 */
import { existsSync, readFileSync } from "node:fs";

export function loadEnvFiles(files: string[] = [".env.local", ".env"]): void {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equals = line.indexOf("=");
      if (equals === -1) continue;
      const key = line.slice(0, equals).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let value = line.slice(equals + 1).trim();
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnvFiles();
