# Assinaturas eletrônicas do RTP — Diagnóstico e plano de correções

Data: 06/11/2026 · Procedimento vigente após as correções: **RTP-ASSINATURA-2**

## 1. Fluxo mapeado

Cadastro → autenticação → geração do documento → congelamento → confirmação → assinatura → armazenamento → PDF → verificação pública.

| Etapa | Como funciona hoje (código) |
|---|---|
| Cadastro | Contas criadas pela administração (`/api/users`); CPF vinculado à conta pela administração em `signer_identities` (único por CPF). Membros externos sem conta: CPF e WhatsApp no cadastro do bolsista ou do convidado. |
| Autenticação | Neon Auth (e-mail e senha). Sessão por cookie. Convidados externos: link individual com validade de 7 dias + CPF + código de 6 dígitos por WhatsApp (5 min, 5 tentativas, 10 envios). |
| Geração | Relatório de viagem (Form. 26) e RTP: conteúdo serializado em JSON canônico. Atas: versão emitida e congelada (`meeting_minute_versions`). |
| Congelamento | Hash SHA-256 do conteúdo. Viagem/RTP: gatilho `guard_signed_content` impede editar após a 1ª assinatura. Atas: versão imutável a partir da emissão. |
| Confirmação | CPF digitado e conferido com o CPF vinculado à conta; caixa de declaração **não** pré-marcada. |
| Assinatura | Transação com bloqueio da solicitação (`FOR UPDATE`); gatilho `enforce_signature_identity` recusa CPF diferente do confirmado; hash da assinatura = SHA-256(hash do documento, solicitação, ordem, conta, CPF, data/hora, IP). |
| Armazenamento | `signature_signers` (CPF, data/hora UTC, IP, navegador, hashes) e `audit_logs`. |
| PDF | Bloco de assinatura por signatário, hash, QR Code, código e fundamentação legal; via assinada arquivada em Documentos; PDFs das atas registrados por hash. |
| Verificação pública | `/verificar/<código>` (viagem/RTP) e `/verificar-documento/<código>` (atas), com CPF mascarado e sem IP. |

## 2. Classificação dos controles (antes das correções)

| Controle | Situação |
|---|---|
| Conta pessoal com senha | Implementado e comprovado |
| CPF vinculado à conta pela administração, conferido em gatilho no banco | Implementado e comprovado |
| Proibição de assinar por outra conta (inclusive administrador) | Implementado (o link pertence à conta) — **vulnerável** a sessão de personificação (`impersonatedBy`) e a sessões antigas |
| Confirmação de e-mail | Não implementado (contas criadas pela administração ficam com `emailVerified = false`) |
| Segundo fator para quem tem conta | Não implementado |
| OTP para convidados externos (uso único, curta validade, limite de tentativas, armazenado como HMAC) | Implementado e comprovado |
| Declaração de vontade | Implementado, mas com texto não versionado e sem registro do texto aceito |
| Hash do conteúdo, congelamento, concorrência | Implementado e comprovado (testes de assinaturas simultâneas) |
| Hash da assinatura recalculável | Implementado e comprovado (26 de 26 assinaturas recalculam) |
| Assinatura criptográfica das evidências | Não implementado (só hashes; hash não é assinatura) |
| Registro à prova de adulteração | **Vulnerável**: um operador do banco podia alterar CPF, IP, data, hash ou apagar assinaturas e reescrever o hash correspondente |
| Versões de ata e PDFs emitidos | Parcial: imutabilidade só por convenção do código |
| Verificação pública | Implementada, mas exibia "DOCUMENTO AUTÊNTICO" sem dizer o tipo de conferência; viagem/RTP: `valid` = situação "concluída", sem recalcular nada |
| Comprovante técnico de evidências | Não implementado |
| Carimbo de tempo de autoridade | Não implementado (relógio do servidor) |
| Aceitação pela FAPTO/UFT | Necessita de validação institucional |

## 3. Riscos identificados

1. **Adulteração por quem administra o banco**: alterar o registro de uma assinatura e recalcular o hash passaria despercebido, porque o hash pode ser recomputado por qualquer um.
2. **Sessão antiga ou personificada**: uma sessão aberta há dias, ou de um administrador personificando a conta, poderia assinar.
3. **Substituição de documento**: viagem/RTP protegidos por gatilho; versões de ata e registros de PDF sem proteção no banco.
4. **Verificação pública otimista**: viagem/RTP davam "válido" sem recalcular hashes nem comparar o conteúdo atual.
5. **Consentimento sem prova do texto**: não era possível demonstrar qual declaração cada pessoa aceitou.
6. **Segregação de funções** (Res. CONSUNI/UFT 138/2025): o fluxo em que o coordenador-beneficiário assina sozinho o próprio Formulário 26 concentra a assinatura num único servidor — ver dossiê, seção 12.

## 4. Plano (classificação e impacto)

| # | Melhoria | Classe | Compatibilidade |
|---|---|---|---|
| 1 | Evidência por assinatura em JSON canônico, gravada na mesma transação, com hash calculado pelo banco | Crítica | Aditiva; assinaturas antigas permanecem sem evidência e são apresentadas como tal |
| 2 | Encadeamento das evidências (hash do anterior) e travas contra UPDATE/DELETE/TRUNCATE | Crítica | Aditiva |
| 3 | Assinatura Ed25519 das evidências com chave fora do banco; chave pública publicada | Crítica | Requer variável `EVIDENCE_SIGNING_KEY` na Vercel; sem ela, grava sem assinatura e informa |
| 4 | Travas: assinatura dada não muda nem é excluída; solicitação concluída só pode ser cancelada; versão de ata e registro de PDF imutáveis | Crítica | Verificado contra todas as rotinas que alteram essas tabelas |
| 5 | Sessão: recusa personificação; exige login com menos de 12 horas | Importante | Usuário com sessão antiga precisa entrar de novo |
| 6 | Declaração exigida, versionada, com hash do texto na evidência | Importante | Páginas abertas antes registram a versão antiga que mostravam |
| 7 | Verificação pública com tipo de conferência (criptográfica, documental, cadastral, mista, falha), conteúdo atual × assinado e conferência local do PDF | Importante | Resposta da API ganha campos; nenhum removido |
| 8 | Comprovante técnico em PDF e exportação do pacote de evidências com verificador offline | Importante | Novo |
| 9 | Segundo fator (OTP) para quem assina com conta | Importante — **pendente** | Exige canal confiável (WhatsApp ou e-mail verificado) para todos |
| 10 | Confirmação de e-mail das contas | Importante — **pendente** | Depende do fluxo do Neon Auth |
| 11 | Carimbo de tempo (RFC 3161 / ACT ICP-Brasil) ou ancoragem externa da cadeia | Opcional — **pendente** | Custo e contrato com provedor |
| 12 | Chave de assinatura em serviço de gestão de chaves (ex.: Vercel KMS) | Opcional — **pendente** | Troca de variável por serviço |
