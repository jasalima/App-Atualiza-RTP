import { after } from 'next/server';
import { z } from 'zod';
import { externalAccess, hasExternalProof, proofCookieName, sendExternalChallenge, verifyExternalChallenge, signExternal } from '@/lib/external-signatures';
import { officialPdf } from '@/lib/minutes-core';
import { dispatchAfterSignature } from '@/lib/signature-dispatch';
import { rateLimit } from '@/lib/rate-limit';
import { isConsentVersion } from '@/lib/legal';
import { sameOrigin, travelError } from '@/lib/travel';
export const runtime = 'nodejs';
type Context = { params: Promise<{ token: string }> };
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request, { params }: Context) {
  try {
    await rateLimit(request, 'external-read', 40);
    const a = await externalAccess((await params).token), verified = hasExternalProof(request, a);
    if (new URL(request.url).searchParams.has('file')) {
      if (!verified) return Response.json({ error: 'Confirme sua identidade antes de ler a ata.' }, { status: 403, headers });
      const pdf = await officialPdf(String(a.source_id));
      return new Response(new Uint8Array(pdf.buffer), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.filename}"` } });
    }
    return Response.json({ name: a.name, label: a.label, phone: `•••• ${String(a.phone).slice(-4)}`, verified, signed: a.signer_status === 'signed', expiresAt: a.expires_at }, { headers });
  } catch (error) { return travelError(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    await rateLimit(request, 'external-action', 12);
    const token = (await params).token, a = await externalAccess(token);
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('challenge'), cpf: z.string().max(20) }),
      z.object({ action: z.literal('verify'), cpf: z.string().max(20), code: z.string().regex(/^\d{6}$/) }),
      z.object({ action: z.literal('sign'), cpf: z.string().max(20), accept: z.literal(true), consentVersion: z.string().max(40).refine(isConsentVersion).optional() })
    ]).parse(await request.json());
    if (body.action === 'challenge') return Response.json(await sendExternalChallenge(token, a, body.cpf), { headers });
    if (body.action === 'verify') {
      const proof = await verifyExternalChallenge(token, a, body.cpf, body.code);
      return Response.json({ verified: true }, { headers: { ...headers, 'Set-Cookie': `${proofCookieName(a)}=${proof}; HttpOnly; SameSite=Strict; Path=/api/external-signatures; Max-Age=600${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` } });
    }
    const result = await signExternal(request, a, body.cpf, body.consentVersion);
    after(() => dispatchAfterSignature(String(a.request_id), 'signed').catch(() => console.error('Falha ao compartilhar ata após assinatura externa.')));
    return Response.json(result, { headers });
  } catch (error) { return travelError(error); }
}
