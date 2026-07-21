import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getR2Client, isR2Configured } from './r2-client.js';
import { backupKeyCategory } from './backup-quota.js';
import { ALLOWED_BACKUP_PREFIXES } from './machine-backup-token.js';

/**
 * List R2 objects under users/{userId}/(outputs|workflows|models)/
 * @param {string} userId
 * @param {{ maxKeys?: number }} [options]
 */
export async function listUserBackupR2Objects(userId, options = {}) {
  const client = getR2Client();
  if (!client) throw new Error('R2 is not configured');

  const uid = String(userId ?? '').trim();
  if (!uid) throw new Error('Missing userId');

  const maxKeys = Math.min(5000, Math.max(1, Math.floor(Number(options.maxKeys ?? 2000) || 2000)));
  const prefix = `users/${uid}/`;
  /** @type {Array<{ r2Key: string; relativeKey: string; sizeBytes: number }>} */
  const objects = [];
  let continuationToken = undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: Math.min(1000, maxKeys - objects.length),
      }),
    );

    for (const item of page.Contents ?? []) {
      const r2Key = String(item.Key ?? '');
      if (!r2Key.startsWith(prefix)) continue;
      const relativeKey = r2Key.slice(prefix.length);
      const root = relativeKey.split('/')[0];
      if (!ALLOWED_BACKUP_PREFIXES.includes(root)) continue;
      if (!relativeKey.includes('/') || relativeKey.endsWith('/')) continue;
      objects.push({
        r2Key,
        relativeKey,
        sizeBytes: Number(item.Size ?? 0) || 0,
      });
      if (objects.length >= maxKeys) break;
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken && objects.length < maxKeys);

  return objects;
}

/**
 * Upsert storage_files rows for backup objects (periodic files + stop archives).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Array<{ relativeKey: string; sizeBytes?: number; fileName?: string }>} entries
 */
export async function upsertBackupStorageFiles(supabaseAdmin, userId, entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { inserted: 0, updated: 0 };

  const { data: existing, error: listError } = await supabaseAdmin
    .from('storage_files')
    .select('id, file_path, file_size_bytes')
    .eq('user_id', userId)
    .eq('storage_type', 'backup');
  if (listError) throw listError;

  /** @type {Map<string, { id: string; file_size_bytes: number }>} */
  const byPath = new Map();
  for (const row of existing ?? []) {
    byPath.set(String(row.file_path), {
      id: String(row.id),
      file_size_bytes: Number(row.file_size_bytes) || 0,
    });
  }

  /** @type {Array<Record<string, unknown>>} */
  const toInsert = [];
  let updated = 0;

  for (const entry of list) {
    const relativeKey = String(entry.relativeKey ?? '').replace(/^\/+/, '');
    if (!relativeKey || relativeKey.includes('..')) continue;
    const root = relativeKey.split('/')[0];
    if (!ALLOWED_BACKUP_PREFIXES.includes(root)) continue;

    const sizeBytes = Math.max(0, Math.floor(Number(entry.sizeBytes ?? 0) || 0));
    const fileName =
      (entry.fileName && String(entry.fileName).trim()) ||
      relativeKey.split('/').pop() ||
      relativeKey;
    const category = backupKeyCategory(relativeKey);
    const prev = byPath.get(relativeKey);

    if (prev) {
      if (prev.file_size_bytes !== sizeBytes) {
        const { error } = await supabaseAdmin
          .from('storage_files')
          .update({
            file_size_bytes: sizeBytes,
            file_name: fileName,
            category,
            updated_at: new Date().toISOString(),
          })
          .eq('id', prev.id);
        if (error) throw error;
        updated += 1;
      }
      continue;
    }

    toInsert.push({
      user_id: userId,
      file_name: fileName,
      file_path: relativeKey,
      file_size_bytes: sizeBytes,
      storage_type: 'backup',
      category,
    });
    byPath.set(relativeKey, { id: 'pending', file_size_bytes: sizeBytes });
  }

  if (toInsert.length) {
    const { error } = await supabaseAdmin.from('storage_files').insert(toInsert);
    if (error) throw error;
  }

  return { inserted: toInsert.length, updated };
}

/**
 * List R2 backup prefix and sync into storage_files (C10).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function reconcileUserBackupFromR2(supabaseAdmin, userId) {
  if (!isR2Configured()) {
    return { ok: false, reason: 'r2_not_configured', inserted: 0, updated: 0, listed: 0 };
  }

  const objects = await listUserBackupR2Objects(userId);
  const result = await upsertBackupStorageFiles(
    supabaseAdmin,
    userId,
    objects.map((o) => ({
      relativeKey: o.relativeKey,
      sizeBytes: o.sizeBytes,
      fileName: o.relativeKey.split('/').pop(),
    })),
  );

  return { ok: true, listed: objects.length, ...result };
}