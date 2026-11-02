import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findRepoRoot(start: string): string {
  let current = start;

  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return start;
}

/**
 * Loads the repository-root .env regardless of the package working directory.
 * In production, environment variables are provided by the platform and this
 * is a no-op when the file does not exist.
 */
export function loadRootEnv(): void {
  const root = findRepoRoot(__dirname);
  config({ path: resolve(root, '.env'), quiet: true });
  config({ quiet: true });
}
