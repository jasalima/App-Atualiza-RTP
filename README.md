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
- gestão administrativa de usuários com senha temporária aleatória, troca obrigatória no primeiro acesso e revogação preservando o histórico;
- instalação como aplicativo no iOS, Android, Windows, macOS, Linux e ChromeOS, com instruções adaptadas ao dispositivo;
- importação privada de PDF/DOCX com SHA-256 e extração estruturada;
- registro de execução separado do planejamento;
- geração individual de RTP com recorte temporal e indicação de lacunas;
- validações críticas que bloqueiam aprovação;
- editor, versões imutáveis, auditoria e exportação DOCX/PDF;
- conferência humana do plano importado antes do uso;
- importação em lote com identificação do bolsista pelo nome no documento;
- geração em lote com quadro de conferência, progresso e repetição só das falhas;
- tratamento de lacunas (registrar, em andamento, reprogramação, exclusão justificada);
- resolução de achados de validação com justificativa auditada;
- regeneração de seção, comparação e restauração de versões;
- dashboard com o ciclo de cada bolsista, tabela de acompanhamento e filtros.

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
2. Defina `NEON_ADMIN_USER_ID`, `NEON_ADMIN_EMAIL` e `NEON_ADMIN_NAME` apenas no terminal local.
3. Execute `npm run db:seed` para associar essa conta como administradora global da aplicação.
4. Entre como administradora, cadastre o projeto inicial e use **Configurações > Cadastrar usuário** para criar os demais acessos.

As variáveis `NEON_ADMIN_*` são usadas somente pelo comando de bootstrap e não precisam ser cadastradas na Vercel. A senha temporária de cada novo usuário é exibida uma única vez; o banco guarda apenas a exigência de troca. Contas revogadas perdem imediatamente o acesso aos dados pelas políticas RLS, sem apagar seu histórico institucional.

## Desenvolvimento

```bash
npm run dev
```

Acesse `http://localhost:3000`. Não existem credenciais padrão no código.

## Instalação nos dispositivos

Em produção, use **Instalar aplicativo** na tela de entrada ou no menu lateral. Quando o navegador disponibiliza o prompt nativo, a instalação começa diretamente; nos demais casos, a aplicação mostra o procedimento específico do dispositivo. O modo instalado exige internet para consultar ou alterar dados e não mantém páginas autenticadas em cache.

## Validação

```bash
npm run check
npm test
npm run build
npm audit
```

## Variáveis

O arquivo `.env.local` (ignorado pelo git) já traz os endpoints do projeto Neon `rtpprojetos`. Faltam apenas os segredos:

- `DATABASE_URL`: Neon Console > rtpprojetos > Connect, string *pooled* do banco `neondb`;
- `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY`: Neon Console > Storage > Credentials, escopos `storage:read` e `storage:write`;
- o bucket privado `rtp-private` precisa existir na branch `production`.

Depois de preencher, rode `npm run db:migrate`. Toda migração que cria ou altera colunas exige recarregar o cache de esquema da Data API, senão gravações nessas colunas falham com `PGRST204`: rode `npx neonctl data-api refresh-schema --project-id billowing-cell-00427875 --branch br-odd-unit-b4gzt32j --database neondb` ou clique em *Refresh schema cache* em Neon Console > Data API.

## Vercel

Importe o repositório na Vercel e vincule o projeto Neon pela integração oficial. Configure todas as variáveis descritas em `.env.example`; somente `NEXT_PUBLIC_NEON_AUTH_URL` e `NEXT_PUBLIC_NEON_DATA_API_URL` podem chegar ao navegador. Preview deployments devem apontar para branches Neon próprias.

Variáveis mínimas para o primeiro deploy:

- `DATABASE_URL`;
- `NEON_AUTH_BASE_URL`;
- `NEON_AUTH_COOKIE_SECRET` — gere com `openssl rand -base64 32`;
- `NEXT_PUBLIC_NEON_AUTH_URL`;
- `NEXT_PUBLIC_NEON_DATA_API_URL`.

Marque-as para Production, Preview e Development conforme os ambientes utilizados. Depois de adicionar ou alterar uma variável na Vercel, faça um novo deploy: valores `NEXT_PUBLIC_*` são incorporados durante o build.

## Estrutura

- `app/`: App Router e Route Handlers;
- `src/`: interface React (`src/screens/` por tela, `src/ui.tsx` com componentes compartilhados) e cliente Neon Data API;
- `lib/`: Neon Auth, conexão server-only e Object Storage;
- `database/migrations/`: esquema e políticas RLS;
- `server/services/`: regras puras de extração, geração e exportação;
- `tests/`: invariantes do motor de relatório e exportações.
