import crypto from 'crypto';
import fs from 'fs';
import ssh2 from 'ssh2';
import { resolveClorePublicEndpoints } from './gpu/providers/clore/clore-mapper.js';

const { Client, utils } = ssh2;

const DEFAULT_SSH_USER = 'root';
const SSH_TIMEOUT_MS = 120_000;

/**
 * @typedef {{
 *   host: string;
 *   port?: number;
 *   username?: string;
 *   password?: string | null;
 * }} SshTarget
 */

/**
 * @param {string} privateKey
 * @returns {string | null}
 */
function getPrivateKeyFingerprint(privateKey) {
  try {
    const parsed = utils.parseKey(privateKey);
    if (parsed instanceof Error) {
      return null;
    }

    const publicKey = parsed.getPublicSSH?.();
    if (!publicKey) {
      return null;
    }

    const digest = crypto.createHash('sha256').update(publicKey).digest('base64');
    return `SHA256:${digest.replace(/=+$/, '')}`;
  } catch {
    return null;
  }
}

function getSshPrivateKey() {
  const inline = process.env.VAST_SSH_PRIVATE_KEY;
  if (inline) {
    return inline.replace(/\\n/g, '\n');
  }

  const keyPath = process.env.VAST_SSH_PRIVATE_KEY_PATH;
  if (keyPath && fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8');
  }

  return null;
}

/** Vast / key-based SSH available. */
export function isSshKeyConfigured() {
  return Boolean(getSshPrivateKey());
}

/**
 * Stable Clore root password (preferred) or any key — enough to attempt backup auth setup.
 * Per-machine password may still be required at connect time.
 */
export function isSshConfigured() {
  return isSshKeyConfigured() || Boolean(String(process.env.CLORE_SSH_PASSWORD ?? '').trim());
}

/**
 * @param {SshTarget} target
 * @returns {Promise<import('ssh2').Client>}
 */
function connectSsh(target) {
  const host = target.host;
  const port = Number(target.port) || 22;
  const username = target.username ?? DEFAULT_SSH_USER;
  const password = target.password ? String(target.password) : null;
  const privateKey = password ? null : getSshPrivateKey();
  const privateKeyLoaded = Boolean(privateKey);
  const privateKeyFingerprint = privateKey ? getPrivateKeyFingerprint(privateKey) : null;

  console.info('====================================');
  console.info('[machine-ssh] SSH connect debug');
  console.info('host:', host);
  console.info('port:', port);
  console.info('username:', username);
  console.info('auth:', password ? 'password' : 'privateKey');
  console.info('privateKey loaded?', privateKeyLoaded);
  console.info('private key fingerprint:', privateKeyFingerprint ?? '(unavailable)');
  console.info('====================================');

  if (!password && !privateKey) {
    return Promise.reject(
      new Error('SSH auth missing (set CLORE_SSH_PASSWORD or VAST_SSH_PRIVATE_KEY)'),
    );
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connection timed out'));
    }, SSH_TIMEOUT_MS);

    conn
      .on('banner', (message) => {
        console.info('[machine-ssh] ssh2 event: banner', message);
      })
      .on('ready', () => {
        console.info('[machine-ssh] ssh2 event: ready');
        clearTimeout(timer);
        resolve(conn);
      })
      .on('error', (error) => {
        console.info('[machine-ssh] ssh2 event: error', error);
        clearTimeout(timer);
        reject(error);
      })
      .on('close', () => {
        console.info('[machine-ssh] ssh2 event: close');
      })
      .on('end', () => {
        console.info('[machine-ssh] ssh2 event: end');
      })
      .connect({
        host,
        port,
        username,
        ...(password ? { password } : { privateKey }),
        readyTimeout: SSH_TIMEOUT_MS,
      });
  });
}

/**
 * @param {SshTarget} target
 * @param {string} command
 */
export async function sshExec(target, command) {
  const conn = await connectSsh(target);

  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) {
        conn.end();
        reject(error);
        return;
      }

      let stdout = '';
      let stderr = '';

      stream
        .on('close', (code) => {
          conn.end();
          if (code === 0) {
            resolve({ stdout, stderr, code });
            return;
          }
          reject(new Error(stderr.trim() || stdout.trim() || `SSH command failed (${code})`));
        })
        .on('data', (data) => {
          stdout += data.toString();
        });

      stream.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    });
  });
}

/**
 * @param {SshTarget} target
 * @param {string} remotePath
 * @returns {Promise<Buffer>}
 */
export async function sshReadFile(target, remotePath) {
  const conn = await connectSsh(target);

  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) {
        conn.end();
        reject(error);
        return;
      }

      const chunks = [];
      const stream = sftp.createReadStream(remotePath);

      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (streamError) => {
        conn.end();
        reject(streamError);
      });
      stream.on('close', () => {
        conn.end();
        resolve(Buffer.concat(chunks));
      });
    });
  });
}

/**
 * @param {SshTarget} target
 * @param {Buffer} content
 * @param {string} remotePath
 */
export async function sshWriteFile(target, content, remotePath) {
  const conn = await connectSsh(target);

  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) {
        conn.end();
        reject(error);
        return;
      }

      const stream = sftp.createWriteStream(remotePath);
      stream.on('error', (streamError) => {
        conn.end();
        reject(streamError);
      });
      stream.on('close', () => {
        conn.end();
        resolve(true);
      });
      stream.end(content);
    });
  });
}

/**
 * @param {Record<string, unknown>} vastInstance
 * @returns {SshTarget | null}
 */
export function resolveSshTargetFromVast(vastInstance) {
  const instance = Array.isArray(vastInstance?.instances)
    ? vastInstance.instances[0]
    : (vastInstance?.instances ?? vastInstance);

  const host =
    (typeof instance?.ssh_host === 'string' && instance.ssh_host) ||
    (typeof instance?.public_ipaddr === 'string' && instance.public_ipaddr) ||
    (typeof instance?.public_ip === 'string' && instance.public_ip) ||
    null;

  const port = Number(
    instance?.ssh_port ?? instance?.machine_dir_ssh_port ?? instance?.direct_port_end ?? 22,
  );

  if (!host) {
    return null;
  }

  const username = DEFAULT_SSH_USER;

  console.info('====================================');
  console.info('SSH TARGET RESOLVED (vast)');
  console.info('host:', host);
  console.info('port:', port);
  console.info('username:', username);
  console.info('====================================');

  return { host, port, username };
}

/**
 * @param {Record<string, unknown>} cloreOrder
 * @param {{ password?: string | null }} [options]
 * @returns {SshTarget | null}
 */
export function resolveSshTargetFromClore(cloreOrder, options = {}) {
  const record = cloreOrder && typeof cloreOrder === 'object' ? cloreOrder : {};
  const endpoints = resolveClorePublicEndpoints(record);
  const host = endpoints.sshHost;
  const port = Number(endpoints.sshPort);

  if (!host || !Number.isFinite(port) || port <= 0) {
    return null;
  }

  const password =
    options.password != null && String(options.password).trim()
      ? String(options.password).trim()
      : String(process.env.CLORE_SSH_PASSWORD ?? '').trim() || null;

  console.info('====================================');
  console.info('SSH TARGET RESOLVED (clore)');
  console.info('host:', host);
  console.info('port:', port);
  console.info('username:', DEFAULT_SSH_USER);
  console.info('password set?', Boolean(password));
  console.info('====================================');

  return {
    host,
    port,
    username: DEFAULT_SSH_USER,
    password,
  };
}
