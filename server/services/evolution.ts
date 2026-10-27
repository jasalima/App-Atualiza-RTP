import { createHash } from 'node:crypto';

export function gesprojectInstance(projectId: string, userId: string) {
  return `Gesproject-${projectId.toLowerCase()}-${createHash('sha256').update(userId).digest('hex').slice(0, 20)}`;
}
export class EvolutionError extends Error {
  constructor(message: string, public status = 502, public providerStatus?: number) { super(message); }
}
export class Evolution {
  constructor(private base = process.env.EVOLUTION_API_URL || '', private masterKey = process.env.EVOLUTION_API_KEY || '', private fetcher: typeof fetch = fetch) {}
  private async call(path: string, key: string, body?: unknown) {
    if (!key) throw new EvolutionError('Configure as credenciais da Evolution API no servidor.', 503);
    let endpoint: URL;
    try { endpoint = new URL(`${this.base.replace(/\/$/, '')}${path}`); } catch { throw new EvolutionError('Configure a URL da Evolution API no servidor.', 503); }
    if (endpoint.protocol !== 'https:') throw new EvolutionError('A Evolution API deve usar HTTPS.', 503);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
    } catch { throw new EvolutionError('Evolution indisponível. Tente novamente para consultar a mesma instância.'); }
    if (!response.ok) throw new EvolutionError(`A Evolution API recusou a operação (HTTP ${response.status}).`, 502, response.status);
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
    const result = await this.call(`/message/sendMedia/${encodeURIComponent(instance)}`, token, { number, mediatype: 'document', mimetype: file.mime, media: file.buffer.toString('base64'), fileName: file.filename, caption });
    const id = result.key?.id;
    if (typeof id !== 'string' || !id) throw new EvolutionError('O servidor não confirmou o identificador do envio.');
    return { messageId: id };
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
