/**
 * Custom resolve hook for `@/` → src/
 * @see scripts/register-src-alias.mjs
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const srcRoot = process.env.GPUVIETNAM_SRC_ROOT;
    if (!srcRoot) {
      return nextResolve(specifier, context);
    }
    const absolute = join(srcRoot, specifier.slice(2));
    return nextResolve(pathToFileURL(absolute).href, context);
  }
  return nextResolve(specifier, context);
}
