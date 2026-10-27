import { useState } from 'react';
import { FileText } from 'lucide-react';
import { route } from '../api';
import SendDocumentButton from '../SendDocumentButton';
import { Empty, Notice, PageHead, Skeleton, fmt, useAsync, useScope } from '../ui';
type StoredDocument = { id: string; scholar_id: string | null; scholar_name: string | null; original_name: string; kind: string; size_bytes: number; created_at: string };
export default function Documents() {
  const { project } = useScope();
  const list = useAsync(() => route<StoredDocument[]>(`/documents?projectId=${project!.id}`), [project?.id]);
  const [search, setSearch] = useState('');
  const rows = (list.data || []).filter(row => `${row.original_name} ${row.scholar_name || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <>
    <PageHead title="Documentos" description="Planos, evidências e arquivos cadastrados no projeto. Use o ícone de envio para compartilhar pelo seu WhatsApp." />
    {list.error ? <Notice tone="crit">{list.error}<p><button className="btn" onClick={() => void list.reload()}>Tentar novamente</button></p></Notice> : !list.data ? <Skeleton /> : <section className="panel">
      <div className="toolbar"><input type="search" className="grow" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar documento" placeholder="Buscar documento ou membro do projeto" /></div>
      <div className="table-wrap"><table className="ledger"><thead><tr><th>Documento</th><th>Membro</th><th>Tamanho</th><th>Cadastro</th><th>Enviar</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><span className="document-name"><FileText />{row.original_name}</span></td><td>{row.scholar_name || 'Documento do projeto'}</td><td>{Number(row.size_bytes) < 1048576 ? `${Math.ceil(Number(row.size_bytes) / 1024)} KB` : `${(Number(row.size_bytes) / 1048576).toFixed(1)} MB`}</td><td>{fmt(row.created_at)}</td><td><SendDocumentButton iconOnly source={{kind:'document',id:row.id,label:row.original_name,scholarId:row.scholar_id}} /></td></tr>)}</tbody></table></div>
      {!rows.length && <Empty title={search ? 'Nenhum documento encontrado' : 'Nenhum arquivo cadastrado'}>Os planos importados e as evidências anexadas aparecerão aqui.</Empty>}
    </section>}
  </>;
}
