import type { Metadata } from 'next';
import '../src/styles.css';

export const metadata: Metadata = {
  title: 'RTP Inteligente · FAPTO',
  description: 'Gestão e geração rastreável de Relatórios Técnicos Parciais.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
