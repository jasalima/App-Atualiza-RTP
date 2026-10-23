# RTP Inteligente

Plataforma institucional para gestão de bolsistas e geração rastreável de Relatórios Técnicos Parciais no padrão do Formulário 9 da FAPTO.

## Arquitetura

- Next.js 16 (App Router), React 19 e TypeScript;
- Neon Postgres como banco relacional;
- Neon Auth para contas, sessões e cookies `httpOnly`;
- Neon Data API para CRUD HTTPS autenticado por JWT e protegido por Row-Level Security;
- Neon Object Storage, compatível com S3, em bucket privado;
- Route Handlers somente para operações transacionais, processamento documental, exportações e URLs temporárias;
- Vercel como destino de publicação.

O SDK `@neondatabase/neon-js` usa sua camada compatível com PostgREST. O endpoint da Data API é público, mas não concede acesso sozinho: cada consulta recebe automaticamente o JWT do Neon Auth e o PostgreSQL aplica as políticas RLS. `DATABASE_URL`, segredo de cookies e credenciais S3 existem apenas no servidor.

## Funcionalidades

- cadastro de projetos e bolsistas isolado por projeto;
- importação privada de PDF/DOCX com SHA-256 e extração estruturada;
- registro de execução separado do planejamento;
- geração individual de RTP com recorte temporal e indicação de lacunas;
- validações críticas que bloqueiam aprovação;
- editor, versões imutáveis, auditoria e exportação DOCX/PDF;
- dashboard e histórico por bolsista.

## Provisionamento Neon

Requisitos: Node.js 20.9+, npm e uma conta Neon.

```bash
npm install
npx neonctl auth
npx neonctl init
npx neonctl link
npx neonctl deploy
npx neonctl env --output .env.local
npm run db:migrate
```

O arquivo [neon.ts](./neon.ts) declara Neon Auth, Data API e o bucket privado `rtp-private`. Confira os nomes gerados no `.env.local` e ajuste-os conforme [.env.example](./.env.example).

1. Crie a primeira conta pela tela de acesso/Neon Auth.
2. Cadastre o projeto inicial pelo SQL Editor ou migração administrativa.
3. Defina `NEON_ADMIN_USER_ID` e `NEON_ADMIN_PROJECT_ID` localmente.
4. Execute `npm run db:seed` para associar essa conta como administradora.

## Desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:3000`. Não existem credenciais padrão no código.

## Validação

```bash
npm run check
npm test
npm run build
npm audit
```

## Vercel

Importe o repositório na Vercel e vincule o projeto Neon pela integração oficial. Configure todas as variáveis descritas em `.env.example`; somente `NEXT_PUBLIC_NEON_AUTH_URL` e `NEXT_PUBLIC_NEON_DATA_API_URL` podem chegar ao navegador. Preview deployments devem apontar para branches Neon próprias.

## Estrutura

- `app/`: App Router e Route Handlers;
- `src/`: interface React e cliente Neon Data API;
- `lib/`: Neon Auth, conexão server-only e Object Storage;
- `database/migrations/`: esquema e políticas RLS;
- `server/services/`: regras puras de extração, geração e exportação;
- `tests/`: invariantes do motor de relatório e exportações.
