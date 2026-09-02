import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../src/config.ts';
import { loadScript } from '../src/script.ts';

test('repoRoot points at the directory holding .env.example and SCRIPT.md', () => {
  for (const f of ['.env.example', 'SCRIPT.md', 'package.json']) {
    assert.ok(existsSync(resolve(repoRoot, f)), `${f} not found at repoRoot (${repoRoot})`);
  }
});

test('the script loads regardless of the working directory', () => {
  const before = process.cwd();
  try {
    process.chdir(resolve(repoRoot, 'services/voice'));
    assert.ok(loadScript().size > 25, 'SCRIPT.md not found from the workspace directory');
  } finally {
    process.chdir(before);
  }
});
