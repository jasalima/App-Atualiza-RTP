import pdf from 'pdf-parse';
import { verifyPdfFile } from '@/lib/minutes-core';
import { rateLimit } from '@/lib/rate-limit';
import { travelError } from '@/lib/travel';
export const runtime = 'nodejs';

const MAX = 4 * 1024 * 1024; // Vercel functions accept request bodies up to 4.5 MB
// "Verificar arquivo PDF": compares the received file with the official files issued by the platform.
export async function POST(request: Request) {
  try {
    await rateLimit(request, 'verify-file', 10);
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) throw Object.assign(new Error('Envie o arquivo PDF da ata.'), { status: 400 });
    if (file.size > MAX) throw Object.assign(new Error('Arquivo maior que 4 MB. Confira pelo código de verificação impresso na ata.'), { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('O arquivo enviado não é um PDF.'), { status: 400 });
    return Response.json(await verifyPdfFile(buffer, async (b) => (await pdf(b)).text), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return travelError(error); }
}
