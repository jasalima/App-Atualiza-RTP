'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="splash"><div style={{ display: 'grid', gap: 12, maxWidth: 420, padding: 24 }}><h2>Não foi possível carregar o sistema</h2><p className="muted">Verifique a conexão com a internet e tente de novo. Se persistir, o ambiente pode estar sem as variáveis do Neon configuradas.</p><div><button className="btn btn-primary" onClick={reset}>Tentar de novo</button></div></div></main>;
}
