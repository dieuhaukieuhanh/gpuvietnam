/**
 * Server startup diagnostics for app.log.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOGGING_VERSION } from './version.js';
import { logger } from './logger.js';
import { getLogsDir } from './init.js';

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readGitCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return String(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 12);
  if (process.env.GIT_COMMIT) return String(process.env.GIT_COMMIT).slice(0, 12);
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Log once-per-process startup identity block.
 */
export function logStartupDiagnostics() {
  const payload = {
    operation: 'server.boot',
    phase: 'START',
    applicationVersion: readPackageVersion(),
    gitCommit: readGitCommit(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    buildTimestamp: process.env.BUILD_TIMESTAMP || process.env.VERCEL_GIT_COMMIT_DATE || new Date().toISOString(),
    loggingVersion: LOGGING_VERSION,
    logsDir: getLogsDir(),
    platform: process.platform,
    pid: process.pid,
  };

  logger('app').info(payload, 'server startup diagnostics');
  return payload;
}
