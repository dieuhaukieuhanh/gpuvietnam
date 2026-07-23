/**
 * Custom resolve hook for `@/` → src/ and extensionless relative imports under src/.
 * @see scripts/register-src-alias.mjs
 *
 * Next.js allows extensionless `@/lib/foo`, `@/lib/dir` (→ index.js), and `./foo`.
 * Also resolves `.ts` for Node `--experimental-strip-types`.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';

/**
 * @param {string} absolute
 */
function resolveSrcPath(absolute) {
  const ext = extname(absolute);
  if (
    ext === '.js' ||
    ext === '.mjs' ||
    ext === '.cjs' ||
    ext === '.json' ||
    ext === '.ts' ||
    ext === '.tsx'
  ) {
    return absolute;
  }
  if (ext) return absolute;

  const asJs = `${absolute}.js`;
  if (existsSync(asJs)) return asJs;

  const asMjs = `${absolute}.mjs`;
  if (existsSync(asMjs)) return asMjs;

  const asTs = `${absolute}.ts`;
  if (existsSync(asTs)) return asTs;

  const asTsx = `${absolute}.tsx`;
  if (existsSync(asTsx)) return asTsx;

  const asIndexJs = join(absolute, 'index.js');
  if (existsSync(asIndexJs)) return asIndexJs;

  const asIndexMjs = join(absolute, 'index.mjs');
  if (existsSync(asIndexMjs)) return asIndexMjs;

  const asIndexTs = join(absolute, 'index.ts');
  if (existsSync(asIndexTs)) return asIndexTs;

  try {
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      return asIndexJs;
    }
  } catch {
    /* ignore */
  }

  return asJs;
}

/**
 * @param {string} absolute
 */
function fileExists(absolute) {
  try {
    return existsSync(absolute) && statSync(absolute).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  const srcRoot = process.env.GPUVIETNAM_SRC_ROOT;

  if (specifier.startsWith('@/')) {
    if (!srcRoot) {
      return nextResolve(specifier, context);
    }
    const absolute = resolveSrcPath(join(srcRoot, specifier.slice(2)));
    return {
      shortCircuit: true,
      url: pathToFileURL(absolute).href,
    };
  }

  // Extensionless relative imports (Next/TS style) when parent lives under src/
  if (
    srcRoot &&
    context.parentURL &&
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !extname(specifier)
  ) {
    try {
      const parentPath = fileURLToPath(context.parentURL);
      if (parentPath.startsWith(srcRoot)) {
        const absolute = resolveSrcPath(join(dirname(parentPath), specifier));
        if (fileExists(absolute)) {
          return {
            shortCircuit: true,
            url: pathToFileURL(absolute).href,
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  return nextResolve(specifier, context);
}
