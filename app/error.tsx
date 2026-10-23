'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="login-page"><section className="login-panel"><div className="login-card"><h1>Não foi possível carregar</h1><p className="muted">Verifique a conexão e tente novamente.</p><button className="btn primary" onClick={reset}>Tentar novamente</button></div></section></main>;
}
