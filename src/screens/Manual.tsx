import { ArrowLeft, Download, FileText, Link2, FileSignature, ClipboardList } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const pdf = '/manual/Manual-do-Usuario-RTP-Inteligente.pdf';
export default function Manual() {
  return <main className="manual-page">
    <NavLink to="/" className="back"><ArrowLeft />Voltar ao sistema</NavLink>
    <header className="manual-intro"><div><BookMark /><h1>Guia do sistema</h1><p>Aprenda cada etapa com instruções, telas ilustradas e fluxos de trabalho.</p></div><a className="btn btn-primary" href={pdf} download><Download />Baixar manual em PDF</a></header>
    <section className="manual-feature"><div><h2>Da preparação à assinatura</h2><p>Um guia para a equipe, a coordenação e os convidados. Consulte o procedimento e confira as condições antes de concluir cada ação.</p><a className="btn" href={pdf} target="_blank" rel="noreferrer"><FileText />Ler manual no navegador</a></div><ol className="manual-flow"><li>Preparar cadastros e plano</li><li>Registrar atividades e documentos</li><li>Revisar, assinar e compartilhar</li></ol></section>
    <section className="manual-topics" aria-label="O que você encontra no manual">
      <article><Link2 /><div><h2>Conectar e enviar</h2><p>WhatsApp por QR Code, arquivos no acervo, destinatários e histórico de envios.</p></div></article>
      <article><FileSignature /><div><h2>Revisar e assinar RTPs</h2><p>Editar antes da assinatura, confirmar o CPF da conta e baixar o PDF assinado.</p></div></article>
      <article><ClipboardList /><div><h2>Atas e convidados externos</h2><p>Participantes, CPF e WhatsApp, link individual e confirmação pelo código recebido.</p></div></article>
    </section>
    <p className="muted">As telas do manual usam dados fictícios. As ações disponíveis dependem do seu perfil e do projeto selecionado.</p>
  </main>;
}
function BookMark() { return <span className="manual-emblem" aria-hidden="true"><FileText /></span>; }
