# Logging

Centralized structured logging for GPUVietnam (Pino + rotating files + request correlation).

Logging version: **2.0.0** (see `src/lib/logging/version.js`).

For AI assistants, also read **AI_DEBUGGING.md**.

## Architecture

```
Request / Worker / Provider
        |
        v
 AsyncLocalStorage context  (requestId, userId, machineId, gpuSessionId, operation)
        |
        v
  redact + serializeError
        |
        v
  logger(channel)  -->  rotating logs/<channel>.log   (+ async console in development)
        |
        +-- error/fatal also -->  logs/error.log
```

| Channel | File | Typical sources |
|---------|------|-----------------|
| `app` | `logs/app.log` | Boot diagnostics, SCB transitions |
| `api` | `logs/api.log` | API routes |
| `worker` | `logs/worker.log` | Machine-operation queue |
| `provider` | `logs/provider.log` | Clore / Vast / failover |
| `error` | `logs/error.log` | Errors + uncaught / unhandled |

## Security & payload limits

Before write, every object is passed through `redactObject`:

- Redacts: Authorization, cookies, JWT/session/access tokens, API keys, passwords, provider secrets, Bearer values
- Omits/truncates: large strings, base64/data-URLs, buffers, deep nests, huge arrays
- API wrappers log `summarizeRequest` only (method/url/content-type) — **never** full bodies

## Rotation

`rotating-file-stream` (async):

| Env | Default | Meaning |
|-----|---------|---------|
| `LOG_ROTATE_SIZE` | `50M` | Max size per file before rotate |
| `LOG_ROTATE_INTERVAL` | `1d` | Time-based rotate |
| `LOG_ROTATE_MAX_FILES` | `14` | Retention count |
| `LOG_ROTATE_COMPRESS` | gzip on | Set `0` to disable |

## Correlation / Support Code

1. Middleware sets `x-request-id` on `/api/*` and `/dashboard/*`.
2. `withApiLogging` stores it in ALS and returns:
   - headers: `x-request-id`, `x-correlation-id`, `x-support-code`
   - JSON: `requestId`, `supportCode` (`REQ-XXXXXXXX`)
3. Dashboard shows Support Code + one-click copy of the full UUID on start failures.
4. Background provision must use `withBackgroundLogContext`.

Trace:

```bash
npm run logs:trace -- <requestId|REQ-XXXXXXXX>
```

## Provider diagnostics

Provider logs should include (when known): `provider`, `offerId`, `instanceId`, `machineId`, `gpuType`, `gpuCount`, `region`, `retryCount`, `httpStatus`, `providerLatencyMs`.

Helper: `providerDiag({ ... })`.

## SCB diagnostics

Every `runMachineTransition` logs `scb.transition` with:

`gpuSessionId`, `machineOperationId`, `projectionVersion`, `settlementVersion`, `stateBefore`, `stateAfter`, `command`, `event`.

(Versions are null until callers pass them in payload/context.)

## Startup diagnostics

On Node boot (`instrumentation.js` → `logStartupDiagnostics`):

application version, git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>", node version, environment, build timestamp, logging version, logsDir, pid.

## Performance

- File writes via async rotating streams (not sync `fs.writeFileSync` on the hot path).
- Console uses `pino.destination({ sync: false })`.
- Sync `mkdir`/`open` only once at boot in `ensureLogsDir`.

## How to start

```bash
npm run dev
npm run start
```

## Code usage

```js
import { logger, logOperation, withApiLogging, providerDiag, logScbTransition } from '@/lib/logging';

export default withApiLogging(handler, { operation: 'user.startMachine' });
```

`logs/` is gitignored.