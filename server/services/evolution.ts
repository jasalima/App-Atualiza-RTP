import { createHash } from 'node:crypto';

export function gesprojectInstance(projectId: string, userId: string) {
  return `Gesproject-${projectId.toLowerCase()}-${createHash('sha256').update(userId).digest('hex').slice(0, 20)}`;
}
export class EvolutionError extends Error {
  constructor(message: string, public status = 502, public providerStatus?: number, public detail?: string) { super(message); }
}
/** Digits only, with Brazil's country code added to a bare DDD + number. */
export function waNumber(value: string) {
  const d = String(value ?? '').replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}
/** Brazilian mobiles may be registered with or without the 9th digit: both forms, the given one first. */
export function waVariants(number: string) {
  const m = /^55(\d{2})(9?)(\d{8})$/.exec(number);
  if (!m || !/^[6-9]/.test(m[3])) return [number];
  return [number, m[2] ? `55${m[1]}${m[3]}` : `55${m[1]}9${m[3]}`];
}
const masked = (n: string) => `•••• ${n.slice(-4)}`;
/** The provider's own explanation, with phone numbers and JIDs removed. */
export function providerDetail(body: unknown): string {
  const pick = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(pick).filter(Boolean).join('; ');
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.exists === false) return 'NUMBER_NOT_ON_WHATSAPP';
      return pick(o.response ?? o.message ?? o.error ?? '');
    }
    return '';
  };
  return pick(body).replace(/\d{8,}(@[\w.]+)?/g, '•••').replace(/\s+/g, ' ').trim().slice(0, 200);
}
// Baileys failures that a fresh attempt usually clears (Evolution v2 reports them as HTTP 400).
const TRANSIENT = /connection (closed|lost|failure)|timed? ?out|socket|not connected|stream errored|precondition|rate.?limit|ECONNRESET|EAI_AGAIN/i;
const NOT_ON_WHATSAPP = /NUMBER_NOT_ON_WHATSAPP|not.*(exist|registered|on whatsapp)/i;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class Evolution {
  constructor(private base = process.env.EVOLUTION_API_URL || '', private masterKey = process.env.EVOLUTION_API_KEY || '', private fetcher: typeof fetch = fetch, private wait: (ms: number) => Promise<unknown> = pause) {}
  private async call(path: string, key: string, body?: unknown) {
    if (!key) throw new EvolutionError('Configure as credenciais da Evolution API no servidor.', 503);
    let endpoint: URL;
    try { endpoint = new URL(`${this.base.replace(/\/$/, '')}${path}`); } catch { throw new EvolutionError('Configure a URL da Evolution API no servidor.', 503); }
    if (endpoint.protocol !== 'https:') throw new EvolutionError('A Evolution API deve usar HTTPS.', 503);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
    } catch { throw new EvolutionError('Evolution indisponível. Tente novamente para consultar a mesma instância.'); }
    if (!response.ok) {
      const detail = providerDetail(await response.json().catch(() => null));
      throw new EvolutionError(`A Evolution API recusou a operação (HTTP ${response.status}${detail ? `: ${detail}` : ''}).`, 502, response.status, detail);
    }
    const result = await response.json().catch(() => null);
    if (!result || result.error) throw new EvolutionError('A Evolution API não confirmou a operação.');
    return result;
  }
  async checkCredentials() {
    const result = await this.call('/instance/fetchInstances', this.masterKey);
    if (!Array.isArray(result)) throw new EvolutionError('O servidor não confirmou as credenciais.');
  }
  async recoverScopedToken(instance: string) {
    const rows = await this.call(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`, this.masterKey);
    const row = Array.isArray(rows) ? rows.find(r => (r.name ?? r.instance?.instanceName ?? r.instanceName) === instance) : null;
    const token = row?.token ?? row?.hash ?? row?.instance?.token;
    if (typeof token !== 'string' || !token) throw new EvolutionError('Não foi possível recuperar a chave desta conexão.', 409);
    await this.state(instance, token);
    return token;
  }
  async sendDocument(instance: string, token: string, file: { buffer: Buffer; mime: string; filename: string }, number: string, caption: string) {
    const media = file.buffer.toString('base64');
    return this.deliver(instance, token, number, (to) => this.call(`/message/sendMedia/${encodeURIComponent(instance)}`, token, { number: to, mediatype: 'document', mimetype: file.mime, media, fileName: file.filename, caption }));
  }
  async sendText(instance: string, token: string, number: string, text: string) {
    return this.deliver(instance, token, number, (to) => this.call(`/message/sendText/${encodeURIComponent(instance)}`, token, { number: to, text }));
  }
  /** The form of the number WhatsApp knows; null when none; undefined when the check itself failed. */
  async resolveNumber(instance: string, token: string, number: string): Promise<string | null | undefined> {
    try {
      const rows = await this.call(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, token, { numbers: waVariants(number) });
      if (!Array.isArray(rows)) return undefined;
      const hit = rows.find((r) => r?.exists === true);
      if (!hit) return null;
      return String(hit.jid ?? hit.number ?? '').split('@')[0].replace(/\D/g, '') || number;
    } catch { return undefined; }
  }
  // One send made resilient: a normalised number; up to three attempts with backoff when the
  // WhatsApp session hiccups (Evolution v2 reports Baileys failures as HTTP 400); the form of the
  // number WhatsApp knows when it rejects the given one; and an error that says what happened.
  private async deliver(instance: string, token: string, raw: string, send: (to: string) => Promise<{ key?: { id?: unknown } }>) {
    const number = waNumber(raw);
    if (!/^[1-9]\d{9,14}$/.test(number)) throw new EvolutionError('Telefone de destino inválido. Confira DDI, DDD e número no cadastro.', 400);
    let to = number, checked = false, last: EvolutionError | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await this.wait(1500 * attempt);
      try {
        const id = (await send(to))?.key?.id;
        if (typeof id !== 'string' || !id) throw new EvolutionError('O servidor não confirmou o identificador do envio.');
        return { messageId: id };
      } catch (error) {
        if (!(error instanceof EvolutionError) || error.status === 503) throw error;
        const p = error.providerStatus, detail = error.detail ?? '';
        if (p === 401 || p === 403) throw new EvolutionError('A chave desta conexão de WhatsApp não foi aceita. Abra Conectividade e use Reconectar.', 409, p, detail);
        if (p === 404) throw new EvolutionError('A conexão de WhatsApp não existe mais no servidor. Abra Conectividade e conecte novamente.', 409, p, detail);
        // No HTTP answer (timeout, network) or an unconfirmed id: the message may have gone out,
        // so never resend it automatically.
        if (p === undefined || (p !== 400 && p !== 429 && p < 500)) throw error;
        last = error;
        if (p === 400 && !checked && !TRANSIENT.test(detail)) {
          checked = true;
          const known = await this.resolveNumber(instance, token, number);
          if (known === null || (known === undefined && NOT_ON_WHATSAPP.test(detail))) throw new EvolutionError(`O número ${masked(number)} não tem WhatsApp ativo. Confira o telefone no cadastro.`, 422, p, detail);
          if (known && known !== to) { to = known; attempt--; continue; }
        }
      }
    }
    const state = await this.state(instance, token).catch(() => null);
    if (state !== 'open') throw new EvolutionError('O WhatsApp de envio está desconectado. Abra Conectividade e escaneie o QR Code.', 409, last?.providerStatus, last?.detail);
    const why = last?.detail ? ` Motivo informado pelo WhatsApp: ${last.detail}.` : '';
    throw new EvolutionError(`O WhatsApp não entregou a mensagem para ${masked(to)} após 3 tentativas.${why} Tente de novo em instantes; se persistir, use Reconectar em Conectividade.`, 502, last?.providerStatus, last?.detail);
  }
  async ensure(instance: string, token: string) {
    let rows: unknown;
    try { rows = await this.call(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`, this.masterKey); }
    catch (error) { if (error instanceof EvolutionError && error.providerStatus === 404) rows = []; else throw error; }
    if (!Array.isArray(rows)) throw new EvolutionError('Resposta inválida da Evolution API.');
    const existing = rows.find(r => (r.name ?? r.instance?.instanceName ?? r.instanceName) === instance);
    if (existing) {
      const remoteToken = existing.token ?? existing.hash ?? existing.instance?.token;
      if (remoteToken && remoteToken !== token) throw new EvolutionError('Conflito de instância: a conexão existente não pertence a este vínculo.', 409);
      // Instance-level authentication must also succeed; never adopt a foreign instance.
      await this.state(instance, token);
      return { created: false };
    }
    try {
      // Do not send event integration objects here: some Evolution versions
      // enable an integration whenever its object is present, ignoring enabled:false.
      const result = await this.call('/instance/create', this.masterKey, { instanceName: instance, token, integration: 'WHATSAPP-BAILEYS', qrcode: false, groupsIgnore: true, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false });
      if (result.instance?.instanceName !== instance) throw new EvolutionError('A Evolution não confirmou o nome da instância criada.');
    } catch (error) {
      // Another request may have created the same scoped instance. Its saved
      // instance token proves ownership; no delete/recreate or token rotation.
      try { await this.state(instance, token); return { created: false }; } catch { throw error; }
    }
    return { created: true };
  }
  async state(instance: string, token: string) {
    const result = await this.call(`/instance/connectionState/${encodeURIComponent(instance)}`, token);
    const state = result.instance?.state ?? result.state;
    if (!['open', 'close', 'connecting'].includes(state)) throw new EvolutionError('Estado da conexão não reconhecido.');
    return state as 'open' | 'close' | 'connecting';
  }
  async connect(instance: string, token: string) {
    const result = await this.call(`/instance/connect/${encodeURIComponent(instance)}`, token);
    const image = result.base64 ?? result.qrcode?.base64;
    const qr = typeof image === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(image) ? image : null;
    return { qr, connected: result.instance?.state === 'open' };
  }
}
