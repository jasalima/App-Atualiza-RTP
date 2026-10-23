# Arquitetura e fronteiras de confiança

```text
Navegador ── Neon Auth (sessão httpOnly)
    │
    ├── @neondatabase/neon-js ── JWT ── Neon Data API ── RLS ── Postgres
    │
    └── Next.js Route Handlers (Vercel)
             ├── Neon Postgres server-only (transações)
             ├── Neon Object Storage privado
             └── geração DOCX/PDF e processamento documental
```

## Identidade e autorização

O Neon Auth administra usuários e sessões no schema `neon_auth`. O navegador não conhece a senha do PostgreSQL. O SDK anexa o JWT às consultas PostgREST e as políticas usam `auth.user_id()` para resolver associações em `user_project_access`.

RLS é habilitado em todas as tabelas institucionais. Administradores e coordenadores podem modificar dados do projeto; bolsistas acessam apenas projetos associados e registram somente a própria execução. Operações server-only repetem a verificação de associação antes de usar a conexão privilegiada.

## Documentos privados

Arquivos são validados por MIME e tamanho, recebem SHA-256 e chave aleatória com prefixo de projeto/usuário. O bucket `rtp-private` não permite leitura anônima. O navegador recebe URLs GET/PUT com validade de cinco minutos, emitidas após autorização. Credenciais S3 ficam exclusivamente na Vercel.

## Fluxo documental

1. Upload para armazenamento privado.
2. Extração tratada como dado não confiável.
3. Proposta estruturada com referência de origem.
4. Conferência humana.
5. Registro de execução separado do planejamento.
6. Geração limitada a projeto, bolsista e período.
7. Lacunas viram pendências; nunca fatos inventados.
8. Validações críticas bloqueiam aprovação.
9. Cada edição cria versão imutável e auditável.

## Ambientes

`neon.ts` mantém Auth, Data API e Storage com a mesma semântica de branches. Cada preview da Vercel deve receber URLs e credenciais da branch Neon correspondente, evitando acesso acidental a produção.

## Interface

SPA React renderizada só no cliente (`src/ClientApp.tsx`), com o projeto em foco mantido no menu lateral. O elemento visual central é o pivô: um círculo por bolsista, dividido nas cinco etapas do ciclo (plano importado, plano conferido, execução registrada, RTP gerado, RTP aprovado), com o braço apontando para a última etapa alcançada. Fontes via `next/font`: Bricolage Grotesque (títulos), Public Sans (interface) e Tinos (pré-visualização do documento, métrica compatível com Times do DOCX).

## Revisão e aprovação

- Plano importado fica `pending_review` até a conferência humana; gerar RTP com plano não conferido produz o achado `PLAN_NOT_CONFIRMED`.
- Achados são resolvidos com justificativa (`validations.resolution_note`) e registro em `audit_logs`; críticos em aberto bloqueiam a aprovação no servidor.
- Numeração do RTP é única por bolsista (`reports_scholar_number_key`), permitindo o mesmo número em lote.
- Exportar um RTP aprovado muda a situação para `exported`.

## Cronograma individualizado

O cronograma do Formulário 29 é a fonte do que estava programado em cada período. A extração de texto simples achata a tabela ("… X X X X X") e perde a coluna de cada marcação, por isso `server/services/schedule.ts` reconstrói a tabela pelas posições do texto no PDF (pdf.js) ou pela tabela HTML do DOCX: agrupa os fragmentos empilhados do cabeçalho em colunas ("Set;Out;Nov;Dez 2026"), converte cada coluna em meses e liga cada linha de marcações à atividade cujas linhas a envolvem, inclusive quando a atividade continua na página seguinte. Cada item do plano guarda `scheduled_months` ('YYYY-MM'); o RTP considera programadas no período apenas as atividades com algum mês dentro dele (`lib/schedule.ts`), cobra comprovação só delas e informa o que o cronograma prevê para os três meses seguintes. O plano é segmentado pelas seções numeradas do formulário e pelos marcadores ●, com heurística de palavras-chave como reserva para outros modelos.
