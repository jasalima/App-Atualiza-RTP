import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from './db';
import { headPrivateObject, signedDownloadUrl, signedUploadUrl } from './storage';
import type { TravelPhoto } from './travel';

// Photos of the "Registro fotográfico" page. The browser converts each image to
// JPEG (Word and PDF embed it as is) and sends it straight to the private bucket;
// the server checks the stored object before adding it to the report.
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024, MAX_PHOTOS = 30;
export const photoAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upload'), size: z.number().int().positive().max(MAX_PHOTO_BYTES, 'A foto excede 8 MB.') }),
  z.object({ action: z.literal('register'), key: z.string().min(10).max(300), name: z.string().trim().min(1).max(160), caption: z.string().trim().max(300), width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000), size: z.number().int().positive().max(MAX_PHOTO_BYTES) }),
  z.object({ action: z.literal('caption'), key: z.string().min(10).max(300), caption: z.string().trim().max(300) }),
  z.object({ action: z.literal('remove'), key: z.string().min(10).max(300) }),
  z.object({ action: z.literal('move'), key: z.string().min(10).max(300), offset: z.union([z.literal(-1), z.literal(1)]) })
]);

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
async function current(projectId: string, reportId: string) {
  const [row] = await sql`SELECT photos FROM travel_reports WHERE id=${reportId}::uuid AND project_id=${projectId}::uuid AND deleted_at IS NULL`;
  if (!row) throw fail('Relatório de viagem não encontrado.', 404);
  return (row.photos ?? []) as TravelPhoto[];
}
async function save(projectId: string, reportId: string, userId: string, photos: TravelPhoto[], action: string) {
  await sql.transaction([
    sql`UPDATE travel_reports SET photos=${JSON.stringify(photos)}::jsonb,updated_at=now() WHERE id=${reportId}::uuid AND project_id=${projectId}::uuid`,
    sql`INSERT INTO audit_logs(user_id,project_id,action,entity_type,entity_id,metadata) VALUES(${userId},${projectId}::uuid,${`photo_${action}`},'travel_report',${reportId},jsonb_build_object('photos',${photos.length}::int))`
  ]);
  return withUrls(photos);
}
/** Five-minute links for the thumbnails shown on screen. */
export async function withUrls(photos: TravelPhoto[]) {
  return Promise.all(photos.map(async (p) => ({ ...p, url: await signedDownloadUrl(p.key, { inline: true, contentType: 'image/jpeg' }) })));
}

/** Runs one photo action for a session already authorized to edit this report. */
export async function photoOperation(projectId: string, reportId: string, userId: string, input: z.infer<typeof photoAction>) {
  if (input.action === 'upload') {
    if ((await current(projectId, reportId)).length >= MAX_PHOTOS) throw fail(`Limite de ${MAX_PHOTOS} fotos por relatório.`, 409);
    const key = `${projectId}/${userId}/photos/${randomUUID()}.jpg`;
    return { key, url: await signedUploadUrl(key, 'image/jpeg') };
  }
  const photos = await current(projectId, reportId);
  if (input.action === 'register') {
    if (!input.key.startsWith(`${projectId}/${userId}/photos/`)) throw fail('Foto enviada fora da área deste usuário e projeto.', 403);
    if (photos.some((p) => p.key === input.key)) return { photos: await withUrls(photos) };
    if (photos.length >= MAX_PHOTOS) throw fail(`Limite de ${MAX_PHOTOS} fotos por relatório.`, 409);
    const stored = await headPrivateObject(input.key);
    if (!stored || stored.size !== input.size) throw fail('A foto não chegou completa ao armazenamento. Envie novamente.', 409);
    return { photos: await save(projectId, reportId, userId, [...photos, { key: input.key, name: input.name, caption: input.caption, width: input.width, height: input.height, size: input.size }], 'add') };
  }
  const index = photos.findIndex((p) => p.key === input.key);
  if (index < 0) throw fail('Foto não encontrada neste relatório.', 404);
  if (input.action === 'caption') return { photos: await save(projectId, reportId, userId, photos.map((p, i) => (i === index ? { ...p, caption: input.caption } : p)), 'caption') };
  if (input.action === 'remove') return { photos: await save(projectId, reportId, userId, photos.filter((_, i) => i !== index), 'remove') };
  const target = index + input.offset;
  if (target < 0 || target >= photos.length) return { photos: await withUrls(photos) };
  const next = [...photos]; [next[index], next[target]] = [next[target], next[index]];
  return { photos: await save(projectId, reportId, userId, next, 'move') };
}
