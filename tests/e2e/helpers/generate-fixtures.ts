/**
 * Regenerate the committed synthetic e2e images (prompt C10) with their dHash assertions:
 *
 *   npx tsx tests/e2e/helpers/generate-fixtures.ts
 *
 * This is a helper, not a Playwright test (the file name does not end in `.spec.ts`).
 */
import path from 'node:path';

import { generateSyntheticPairs } from './images';

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
  const pairs = await generateSyntheticPairs(outDir);
  for (const pair of pairs) {
    console.info(
      `[e2e:fixtures] ${path.basename(pair.beforeFile)} + ${path.basename(pair.afterFile)} · ` +
        `dHash ${pair.beforeDhash}/${pair.afterDhash} · distance ${pair.distance} (>= 20 required)`,
    );
  }
  console.info(`[e2e:fixtures] wrote ${pairs.length * 2} synthetic images to ${path.relative(process.cwd(), outDir)}`);
}

main().catch((error: unknown) => {
  console.error('[e2e:fixtures] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
