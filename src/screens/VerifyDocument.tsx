import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, FileSearch, ShieldCheck, ShieldX, Upload, XCircle } from 'lucide-react';
import { minutes } from '../api';
import type { DocumentVerification, FileVerification } from '../types';
import { dateShort } from '@/lib/minutes-model';
import { Notice, Pivot, Skeleton, errorText } from '../ui';
import { LegalBasis } from './Signatures';

// Public page behind the QR Code of the atas: the result comes from the stored records
// (content hash and every signature recomputed), never from the mere existence of the code.
const when = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso)).replace(',', ' às') : '—';
const TONE: Record<DocumentVerification['result'], 'ok' | 'info' | 'warn' | 'crit'> = { signed: 'ok', partial: 'info', unsigned: 'info', cancelled: 'crit', superseded: 'warn', not_found: 'warn', integrity_failure: 'crit' };
const HEADLINE: Record<DocumentVerification['result'], string> = {
  signed: 'DOCUMENTO AUTÊNTICO', partial: 'DOCUMENTO AUTÊNTICO — ASSINATURAS EM ANDAMENTO', unsigned: 'DOCUMENTO AUTÊNTICO — AINDA SEM ASSINATURAS',
  cancelled: 'DOCUMENTO CANCELADO', superseded: 'DOCUMENTO SUBSTITUÍDO', not_found: 'DOCUMENTO NÃO LOCALIZADO', integrity_failure: 'FALHA DE INTEGRIDADE'
};
const DETAIL: Record<DocumentVerification['result'], string> = {
  signed: 'O conteúdo confere com o registro original e todas as assinaturas previstas foram concluídas.',
  partial: 'O conteúdo confere com o registro original. Parte das assinaturas ainda não foi concluída.',
  unsigned: 'O conteúdo confere com o registro original, mas nenhuma assinatura foi registrada até agora.',
  cancelled: 'Este documento foi cancelado pela coordenação do projeto e não tem mais validade.',
  superseded: 'Existe uma versão posterior desta ata. Solicite a versão vigente a quem enviou o documento.',
  not_found: 'Nenhum documento corresponde a este código. Confira os caracteres digitados.',
  integrity_failure: 'Os registros deste documento não conferem com os hashes emitidos. Não utilize este documento e comunique a coordenação do projeto.'
};

export default function VerifyDocumentPage() {
  const { code } = useParams(), navigate = useNavigate();
  const [input, setInput] = useState(code ?? ''), [result, setResult] = useState<DocumentVerification | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!code) return;
    setBusy(true); setError(''); setInput(code);
    minutes.verify(code).then(setResult, (e) => { setResult(null); setError(errorText(e)); }).finally(() => setBusy(false));
  }, [code]);
  const ok = result && ['signed', 'partial', 'unsigned'].includes(result.result);
  return <main className="verify">
    <div className="verify-card verify-doc">
      <header className="verify-brand"><Pivot sectors={['on', 'on', 'on', 'warn', 'off']} size={34} /><div><b>RTP Inteligente</b><span>VERIFICAÇÃO DE AUTENTICIDADE DOCUMENTAL</span></div></header>
      <form className="verify-form" onSubmit={(e) => { e.preventDefault(); navigate(`/verificar-documento/${input.trim().toUpperCase()}`); }}>
        <label className="field">Código de verificação<input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} /></label>
        <button className="btn btn-primary" disabled={busy || input.replace(/[^0-9A-Z]/gi, '').length !== 16}>Verificar</button>
      </form>
      {busy ? <Skeleton /> : error ? <Notice tone="crit">{error}</Notice> : result && <div className="stack" style={{ gap: 16 }}>
        <div className="verify-result" data-tone={TONE[result.result]} role="status">
          {ok ? <ShieldCheck /> : result.result === 'not_found' ? <CircleAlert /> : <ShieldX />}
          <div><b>{HEADLINE[result.result]}</b><p>{DETAIL[result.result]}</p></div>
        </div>
        {result.number && <>
          <dl className="facts">
            <div><dt>Documento</dt><dd>{result.type} · {result.number}</dd></div>
            <div><dt>Projeto</dt><dd>{result.project}</dd></div>
            <div><dt>Assunto</dt><dd>{result.subject || '—'}</dd></div>
            <div><dt>Data da reunião</dt><dd>{result.meetingDate ? dateShort(result.meetingDate) : '—'}</dd></div>
            <div><dt>Emissão</dt><dd>{when(result.issuedAt)} · versão {result.version}{result.latestVersion && result.latestVersion > (result.version ?? 0) ? ` (há versão ${result.latestVersion})` : ''}</dd></div>
            <div><dt>Situação</dt><dd>{result.situation}</dd></div>
            <div><dt>Assinaturas</dt><dd>{result.signatures?.done} de {result.signatures?.total} concluídas</dd></div>
            <div><dt>Código</dt><dd><code>{result.code}</code></dd></div>
          </dl>
          {!!result.signers?.length && <div>
            <h3 className="verify-h">Signatários</h3>
            <ol className="sign-steps">{result.signers.map((s, i) => <li key={i} data-status={s.status === 'signed' ? 'signed' : 'pending'}>
              <span className="sign-step-n">{s.status === 'signed' ? <CheckCircle2 /> : s.status === 'rejected' ? <XCircle /> : i + 1}</span>
              <div><b>{s.name}</b><small>{s.roleLabel}</small><small>{s.status === 'signed' ? `Assinou em ${when(s.signedAt)} (horário de Brasília)` : s.status === 'rejected' ? 'Recusou a assinatura' : 'Assinatura pendente'}</small>{s.signatureId && <small className="hash">Identificador da assinatura: {s.signatureId}</small>}</div>
            </li>)}</ol>
          </div>}
          {result.checks && <ul className="verify-checks">
            <li data-ok={result.checks.content}>{result.checks.content ? <CheckCircle2 /> : <XCircle />}Conteúdo confere com o hash SHA-256 emitido</li>
            <li data-ok={result.checks.signatures}>{result.checks.signatures ? <CheckCircle2 /> : <XCircle />}Registros de assinatura conferem (nome, data, hora e evidências eletrônicas)</li>
          </ul>}
          <p className="hash verify-hash">Hash do conteúdo (SHA-256): {result.contentHash}</p>
          <LegalBasis />
          <p className="muted verify-note">Consulta realizada em {when(result.checkedAt)}. Por proteção de dados pessoais, CPF, endereço IP e e-mails dos signatários não são exibidos.</p>
        </>}
      </div>}
      <FileCheck />
    </div>
  </main>;
}

/** Upload of a received PDF to compare it with the official files issued by the platform. */
function FileCheck() {
  const input = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [result, setResult] = useState<FileVerification | null>(null), [error, setError] = useState(''), [name, setName] = useState('');
  async function check(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(''); setResult(null); setName(file.name);
    try { setResult(await minutes.verifyFile(file)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return <section className="verify-file">
    <h3 className="verify-h"><FileSearch size={18} />Verificar arquivo PDF</h3>
    <p className="muted">Envie o PDF recebido para compará-lo com as vias oficiais emitidas pela plataforma. O arquivo é analisado e descartado: nada é armazenado.</p>
    <button className="btn" disabled={busy} onClick={() => input.current?.click()}><Upload />{busy ? 'Conferindo…' : 'Selecionar PDF'}</button>
    <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => void check(e.target.files?.[0])} />
    {error && <Notice tone="crit">{error}</Notice>}
    {result && (result.match
      ? <Notice tone="ok" title="Arquivo idêntico a uma via oficial">“{name}” é exatamente a via emitida em {when(result.issuedAt)}, com {result.signaturesInFile} assinatura(s).{(result.latestSignatures ?? 0) > (result.signaturesInFile ?? 0) ? ` Já existe via mais recente, com ${result.latestSignatures} assinatura(s).` : ''} Situação atual: {result.verification?.text}.</Notice>
      : result.claimedCode
        ? <Notice tone="crit" title="Arquivo diferente das vias oficiais">“{name}” menciona o código {result.claimedCode} ({result.verification?.number}), mas não corresponde a nenhuma via emitida: pode ter sido alterado ou salvo novamente por outro programa. Confira o conteúdo pela página do código e solicite a via oficial.</Notice>
        : <Notice tone="warn" title="Documento não identificado">Não encontramos neste arquivo uma ata emitida pela plataforma RTP Inteligente.</Notice>)}
  </section>;
}
