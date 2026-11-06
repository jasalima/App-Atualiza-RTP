# Relatório de testes — procedimento RTP-ASSINATURA-2

Executados em 06/11/2026. Testes unitários: `npx vitest run` (218 aprovados). Integração com banco real: ramificação descartável do Neon com cópia dos dados de produção, `RUN_DB_TESTS=1 TEST_DATABASE_URL=<ramificação> npx vitest run tests/minutes-db.test.ts` (9 aprovados). **Nunca rodar a integração contra a produção**: registros assinados não podem ser apagados.

| Cenário exigido | Resultado | Onde |
|---|---|---|
| Assinatura individual | Aprovado; grava assinatura + evidência na mesma transação | `signatures.test.ts` |
| Assinaturas simultâneas | Aprovado: 5 assinaturas disparadas juntas, nenhuma perdida, só uma conclui | `minutes-db.test.ts` (C) |
| Repetição de requisição | Aprovado: segunda tentativa não grava | `minutes-db.test.ts` (C), `signatures.test.ts` |
| Sessão expirada / antiga | Aprovado: login com mais de 12 h é recusado | `signature-evidence.test.ts` |
| Assinatura por terceiro | Aprovado: link de outra conta recusado; personificação recusada; CPF diferente recusado pelo banco | `signatures.test.ts`, `signature-evidence.test.ts`, gatilho `enforce_signature_identity` |
| Alteração do documento após assinatura | Aprovado: o banco recusa alterar versão emitida; viagem/RTP bloqueados; verificação compara conteúdo atual × assinado | `minutes-db.test.ts` (G), `signatures.test.ts` |
| Alteração de hashes e evidências | Aprovado: UPDATE/DELETE recusados; payload ou hash refeitos são denunciados pela assinatura Ed25519 | `minutes-db.test.ts` (G), `signature-evidence.test.ts` |
| Exclusão ou manipulação de registros | Aprovado: exclusão de assinatura, solicitação com assinaturas e evidências recusada; elo removido quebra o encadeamento | idem |
| Validação pública de documento legítimo | Aprovado: as 6 atas e os 6 formulários reais conferem (nível cadastral para assinaturas anteriores) | conferência na ramificação |
| Validação de PDF adulterado | Aprovado (atas: arquivo diferente das vias oficiais; viagem/RTP: hash local difere) | `VerifyDocument`, `LocalFileCheck` |
| Preservação das assinaturas antigas | Aprovado: 26 de 26 hashes de assinatura recalculam; nenhum registro antigo alterado; marcadas como "cadastral" | conferência na ramificação |
| Indisponibilidade do serviço de autenticação | Comportamento: sem sessão válida a assinatura é recusada (401); nenhuma assinatura é gravada | `requireUser` |
| Falha de banco e recuperação | Comportamento: assinatura e evidência na mesma transação — ou ambas gravam, ou nenhuma | `sql.transaction` |
| Revogação e comprometimento de credenciais | Conta revogada não assina (`managed_users.revoked_at`); cancelamento e recusa entram na cadeia de evidências; **troca da chave do servidor**: as chaves anteriores permanecem publicadas para validar evidências antigas | `signature_evidence_keys` |
| Verificador offline | Aprovado: pacote íntegro confere; pacote com IP alterado falha em hash e assinatura | `scripts/verificar-evidencias.mjs` |
