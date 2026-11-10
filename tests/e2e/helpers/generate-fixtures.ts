/**
 * Regenerate the committed synthetic e2e images (prompt C10) with their dHash assertions:
 *
 *   npx tsx tests/e2e/helpers/generate-fixtures.ts
 *
 * This is a helper, not a Playwright test (the file name does not end in `.spec.ts`).
 */
import path from 'node:path';

import { generateSyntheticPair, hamming } from './images';

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
  const pair = await generateSyntheticPair(outDir);
  console.info(
    `[e2e:fixtures] wrote ${path.relative(process.cwd(), pair.beforeFile)} and ${path.relative(process.cwd(), pair.afterFile)}`,
  );
  console.info(
    `[e2e:fixtures] dHash before=${pair.beforeDhash} after=${pair.afterDhash} distance=${pair.distance} (>= 20 required)`,
  );
  console.info(`[e2e:fixtures] before/after hamming=${hamming(pair.beforeDhash, pair.afterDhash)} (NO_CHANGE would need <= 4)`);
}

main().catch((error: unknown) => {
  console.error('[e2e:fixtures] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
