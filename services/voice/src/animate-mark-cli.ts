/**
 * Writes the standalone animated marks into brand/assets from the same
 * choreography the pages use, so the two cannot drift. `npm run animate-mark`.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './config.ts';
import { FILES, markFile } from './signup/mascot.ts';

for (const name of Object.keys(FILES)) {
  writeFileSync(resolve(repoRoot, 'brand', 'assets', name), markFile(name));
  console.log(name);
}
