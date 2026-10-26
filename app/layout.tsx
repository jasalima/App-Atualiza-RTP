import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Public_Sans, Tinos } from 'next/font/google';
import '../src/styles.css';

// Fonts are self-hosted by next/font; the CSS tokens read these variables.
const display = Bricolage_Grotesque({ subsets: ['latin', 'latin-ext'], axes: ['opsz', 'wdth'], variable: '--font-display' });
const ui = Public_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-ui' });
const doc = Tinos({ subsets: ['latin', 'latin-ext'], weight: ['400', '700'], style: ['normal', 'italic'], variable: '--font-doc' });

export const metadata: Metadata = {
  title: 'RTP Inteligente · FAPTO',
  description: 'Gestão e geração rastreável de Relatórios Técnicos Parciais.',
  applicationName: 'RTP Inteligente',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/pwa/192', sizes: '192x192', type: 'image/png' }, { url: '/pwa/512', sizes: '512x512', type: 'image/png' }],
    apple: [{ url: '/pwa/180', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'RTP Inteligente', statusBarStyle: 'black-translucent' },
};

// viewport-fit=cover lets the phone tab bar sit above the home indicator (safe-area insets).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#12303a' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" className={`${display.variable} ${ui.variable} ${doc.variable}`}><body>{children}</body></html>;
}
