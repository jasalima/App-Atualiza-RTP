import { settings } from '../api';
import { Notice, PageHead, Skeleton, Tag, useAsync } from '../ui';

export default function SettingsPage() {
  const { data, error } = useAsync(() => settings.status(), []);
  const row = (ok: boolean, title: string, detail: string, missing: string) => <li><div>{title}<small>{ok ? detail : missing}</small></div><Tag tone={ok ? 'ok' : 'crit'}>{ok ? 'Configurado' : 'Pendente'}</Tag></li>;
  return <>
    <PageHead title="Configurações" description="Estado das integrações do ambiente. Credenciais ficam só no servidor; esta tela mostra se existem, nunca o valor." />
    {error ? <Notice tone="crit">{error}</Notice> : !data ? <Skeleton /> : <div className="stack">
      <section className="panel">
        <div className="panel-head"><div><h2>Infraestrutura</h2></div></div>
        <ul className="checks">
          {row(data.database, 'Banco de dados Neon Postgres', 'Conexão do servidor disponível.', 'Defina DATABASE_URL no ambiente do servidor.')}
          {row(data.auth, 'Neon Auth', 'Sessões e cookies protegidos configurados.', 'Defina NEON_AUTH_BASE_URL e NEON_AUTH_COOKIE_SECRET.')}
          {row(data.dataApi, 'Neon Data API', 'Consultas protegidas por JWT e RLS.', 'Defina NEXT_PUBLIC_NEON_DATA_API_URL e refaça o build.')}
          {row(data.storage, `Armazenamento privado (${data.bucket})`, 'Planos e evidências são guardados no bucket privado.', 'Defina AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY. Sem isso, a importação de planos falha.')}
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Motor de redação</h2></div></div>
        <ul className="checks">
          <li><div>{data.ai.provider === 'local' ? 'Motor local por regras' : `Provedor ${data.ai.provider}${data.ai.model ? `, modelo ${data.ai.model}` : ''}`}<small>{data.ai.provider === 'local' ? 'Monta o texto apenas a partir do plano e dos registros, sem modelo de linguagem. Não reescreve nem amplia a redação.' : 'Credencial lida do ambiente do servidor.'}</small></div><Tag tone={data.ai.configured ? 'ok' : 'crit'}>{data.ai.configured ? 'Ativo' : 'Sem credencial'}</Tag></li>
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Modelo institucional</h2><p>Formulário 9 da FAPTO, Relatório Técnico Parcial.</p></div></div>
        <div className="panel-pad" style={{ paddingTop: 8 }}>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14 }}>
            <li>Cabeçalho: fundação, formulário e título do relatório</li>
            <li>Identificação: projeto, bolsista, vigência da bolsa e número do RTP</li>
            <li>1.1 Objetivos propostos versus objetivos alcançados</li>
            <li>1.2 Resultados esperados versus resultados obtidos</li>
            <li>2. Informações adicionais</li>
            <li>Local, data e área de assinatura do bolsista</li>
          </ol>
        </div>
      </section>
    </div>}
  </>;
}
