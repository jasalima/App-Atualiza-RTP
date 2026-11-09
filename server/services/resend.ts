// Resend e-mail API, called from the server only (the key never reaches the browser).
// REST instead of the SDK: one endpoint, and errors become statuses the routes understand.
export type EmailAttachment = { filename: string; content: Buffer };
export type OutgoingEmail = { from: string; to: string[]; cc?: string[]; replyTo?: string; subject: string; text: string; html: string; attachments?: EmailAttachment[] };

export class EmailError extends Error {
  constructor(message: string, public status: number, public providerStatus?: number) { super(message); }
}

export function emailConfig() {
  const key = process.env.RESEND_API_KEY?.trim() ?? '', from = process.env.EMAIL_FROM?.trim() ?? '';
  return { key, from, ready: Boolean(key && from) };
}

export async function sendEmail(email: OutgoingEmail, idempotencyKey: string, fetcher: typeof fetch = fetch) {
  const { key } = emailConfig();
  if (!key) throw new EmailError('O envio de e-mail ainda não foi configurado: cadastre RESEND_API_KEY e EMAIL_FROM na Vercel.', 409);
  let response: Response;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.slice(0, 256) },
      body: JSON.stringify({
        from: email.from, to: email.to, cc: email.cc?.length ? email.cc : undefined, reply_to: email.replyTo || undefined,
        subject: email.subject, text: email.text, html: email.html,
        attachments: email.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') }))
      })
    });
  } catch {
    throw new EmailError('O serviço de e-mail não respondeu. Confira no histórico antes de reenviar.', 504);
  }
  const body = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (response.ok && body.id) return { id: body.id };
  const reason = body.message ?? `HTTP ${response.status}`;
  if (response.status === 401) throw new EmailError('A chave do Resend (RESEND_API_KEY) foi recusada. Confira a chave cadastrada na Vercel.', 409, 401);
  if (response.status === 403) throw new EmailError(`O Resend recusou o remetente: o domínio de EMAIL_FROM precisa estar verificado no Resend. (${reason})`, 409, 403);
  if (response.status === 422 || response.status === 400) throw new EmailError(`O Resend recusou a mensagem: ${reason}`, 422, response.status);
  if (response.status === 429) throw new EmailError('Limite de envios do Resend atingido. Tente novamente em instantes.', 429, 429);
  throw new EmailError(`Falha no serviço de e-mail: ${reason}`, 502, response.status);
}
