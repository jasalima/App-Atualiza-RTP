# Dossiê Técnico-Jurídico de Assinaturas Eletrônicas do RTP

Versão 1 · 06/11/2026 · Procedimento **RTP-ASSINATURA-2** · Destinado à análise da Fundação de Apoio Científico e Tecnológico do Tocantins (FAPTO)

> Este dossiê descreve o mecanismo e suas limitações. Ele não afirma que a FAPTO, a UFT ou qualquer órgão tenha aprovado o sistema; a seção 13 propõe justamente essa análise.

## 1. Sistema e responsáveis

**RTP Inteligente** — plataforma web de gestão de projetos de pesquisa, desenvolvimento e inovação (planos de trabalho, Relatórios Técnicos Parciais, prestação de contas de diárias pelo Formulário 26, atas de reunião), hospedada na Vercel, com banco de dados PostgreSQL (Neon) e autenticação Neon Auth.

| Papel | Responsável |
|---|---|
| Projeto que utiliza o sistema | Elaboração do Plano de Desenvolvimento Sustentável do Polo de Agricultura Irrigada do Sudoeste do Tocantins (UFT) |
| Coordenação do projeto | [nome, cargo e contato — a preencher] |
| Administração e operação técnica do sistema | [nome, cargo e contato — a preencher] |
| Encarregado de dados pessoais (LGPD) | [a designar] |

## 2. Fundamentos jurídicos

- **MP nº 2.200-2/2001, art. 10, § 2º** — admite outros meios de comprovação da autoria e integridade de documentos eletrônicos, inclusive com certificados não emitidos pela ICP-Brasil, **desde que admitido pelas partes como válido ou aceito pela pessoa a quem for oposto o documento**. É a base da validade das assinaturas do RTP — e a razão pela qual a aceitação pela FAPTO é necessária.
- **Lei nº 14.063/2020, art. 4º** — classifica as assinaturas eletrônicas em simples, avançada e qualificada (ICP-Brasil). **Art. 5º** — fixa os níveis mínimos para interações com entes públicos; aplica-se a documentos dirigidos à UFT ou a órgãos públicos, conforme ato de cada ente.
- **Código Civil, art. 107** — a validade da declaração de vontade não depende de forma especial, salvo quando a lei a exigir.
- **Lei nº 13.709/2018 (LGPD)** — tratamento de nome, CPF, IP e telefone para o cumprimento de obrigação e para o exercício regular de direitos (art. 7º, II e VI), com minimização e segurança (art. 6º, III e VII; art. 46).
- **Lei nº 8.958/1994 e Decreto nº 7.423/2010** — relação entre as instituições de ensino e as fundações de apoio; exigem prestação de contas e controle, mas **não estabelecem forma específica de assinatura eletrônica** (verificado no texto consultado).
- **Resolução CONSUNI/UFT nº 138/2025** — relação UFT–fundações de apoio. Não regula assinatura eletrônica; prevê relatórios técnicos de cumprimento do objeto (art. 48) e a **segregação de funções**, para evitar que propositura, homologação, assinatura, coordenação e fiscalização se concentrem num único servidor, em especial o coordenador.
- **Manual de Orientações da FAPTO** (vigente desde agosto de 2022) — item 3.3: o relatório do projeto "deverá ser encaminhado em uma versão on-line com **assinatura digital certificada**"; item 8.4: prestação de contas de diárias pelo Formulário 26 em até 15 dias corridos após o retorno; item 12.12: o RTP do bolsista (Formulário 9) é enviado por upload no sistema da FAPTO.

## 3. Classificação justificada

As assinaturas do RTP são **assinaturas eletrônicas** com evidências de autoria e integridade. **Não são qualificadas** (não usam certificado ICP-Brasil) e **este dossiê não as declara avançadas**: dos requisitos da assinatura avançada (art. 4º, II, da Lei 14.063/2020), a vinculação inequívoca ao signatário e a detecção de alteração estão demonstradas; o "controle exclusivo com elevado nível de confiança" está apenas parcialmente demonstrado, porque quem tem conta assina com senha e sessão recente, sem segundo fator (ver matriz, seção 12).

Por documento:

| Documento | Uso do RTP | Observação |
|---|---|---|
| Atas de reunião da equipe | Adequado como documento interno do projeto | Assinatura simultânea; externos com OTP |
| Formulário 26 (diárias) | Depende de aceitação da FAPTO | O Manual não exige forma específica de assinatura para o Form. 26 |
| RTP do bolsista (Formulário 9) | Depende de aceitação da FAPTO | Enviado por upload no sistema da FAPTO |
| Relatório técnico do projeto | **Não atende** ao item 3.3 do Manual ("assinatura digital certificada") | Usar assinatura ICP-Brasil ou gov.br até manifestação da FAPTO |
| Contratos e declarações com efeitos patrimoniais | Não recomendado sem acordo expresso | Preferir ICP-Brasil/gov.br |

## 4. Identificação e autenticação

1. **Conta pessoal**: criada pela administração; login por e-mail e senha (troca obrigatória da senha temporária no primeiro acesso).
2. **Vínculo de identidade**: o CPF é conferido pela administração e vinculado a uma única conta (`signer_identities`, CPF único). Um gatilho no banco recusa assinatura com CPF diferente do vinculado, mesmo que o pedido chegue por outro caminho.
3. **Na assinatura**: o signatário digita o CPF; a sessão precisa ter **menos de 12 horas** desde o login, e uma sessão de **personificação** é recusada. Só um resumo (hash) do identificador da sessão vai para a evidência.
4. **Membros e convidados externos sem conta**: link individual com validade; CPF conferido com o cadastrado; código de **uso único** com 6 dígitos, validade de 5 minutos e até 5 tentativas, enviado ao WhatsApp cadastrado; o código é guardado apenas como HMAC.
5. O método usado fica registrado na evidência (`conta_pessoal_cpf_confirmado` ou `link_individual_cpf_codigo_whatsapp`). O recebimento do código prova o controle do telefone naquele momento — **não é, sozinho, prova incontestável de identidade**.

## 5. Manifestação de vontade

Antes de assinar, o signatário vê o documento definitivo, seu nome e função e a declaração (versão **DECL-2026-11**):

> "Declaro que li e estou ciente do conteúdo integral deste documento, manifestando expressamente minha concordância com sua assinatura por meio eletrônico. Reconheço que esta operação ficará vinculada à minha identificação pessoal e aos respectivos registros eletrônicos de autenticação, integridade e auditoria, observadas as disposições legais aplicáveis."

A caixa nunca vem marcada; o aceite é por documento. A evidência registra a versão aceita, o **SHA-256 do texto exato**, o horário, o resumo da sessão e o hash do conteúdo apresentado. Textos nunca são editados: nova redação recebe nova versão.

## 6. Mecanismos criptográficos

| Elemento | O que é | Para que serve |
|---|---|---|
| Hash do conteúdo | SHA-256 do JSON canônico do documento (atas: da versão emitida) | Detectar qualquer alteração do conteúdo |
| Hash do PDF | SHA-256 do arquivo PDF emitido | Identificar se um arquivo é exatamente uma via emitida |
| Hash da assinatura | SHA-256(hash do conteúdo, solicitação, ordem, conta, CPF, data/hora, IP) | Vincular cada assinatura ao conteúdo e ao signatário |
| Hash da evidência | SHA-256 do texto da evidência, calculado pelo próprio banco | Detectar alteração do registro |
| Encadeamento | SHA-256(encadeamento anterior + hash da evidência) | Detectar exclusão, inserção ou reordenação de registros |
| **Assinatura do servidor** | **Ed25519** sobre o texto da evidência, com chave privada fora do banco | Demonstrar que o registro foi produzido pela plataforma e não foi refeito depois |

Hash **não é assinatura digital**: qualquer pessoa recalcula um hash. A assinatura Ed25519 só pode ser produzida com a chave privada do servidor e é verificável com a chave pública publicada em `/api/public/evidence-key`. Impressão digital da chave atual: **[preencher com a chave configurada em produção]**.

**Data e hora**: relógio do servidor, gravadas em UTC e exibidas no horário de Brasília. **Não há carimbo de tempo de autoridade certificadora**; o encadeamento prova a ordem relativa dos registros, não a hora oficial.

## 7. Integridade e preservação

- **Congelamento**: atas assinam uma versão imutável; formulários de viagem e RTPs ficam bloqueados a partir da primeira assinatura. Alterar o conteúdo exige cancelar e abrir nova solicitação; o histórico permanece.
- **Travas no banco** (migração 023): assinatura registrada não pode ser alterada nem excluída; solicitação concluída mantém hash, código e data e só pode ser cancelada; solicitação encerrada não reabre; versão emitida de ata e registro de PDF emitido não mudam; evidências não aceitam UPDATE, DELETE nem TRUNCATE.
- **Assinaturas simultâneas**: cada assinatura é um evento próprio, na mesma transação da evidência, com bloqueio da solicitação; testes demonstram que cliques simultâneos não perdem nem duplicam assinaturas e que só um conclui a solicitação.
- **Limite honesto**: o proprietário do banco de dados pode desativar gatilhos. Nesse caso, a alteração ainda é detectada pela **assinatura Ed25519**, cuja chave não está no banco; o risco remanescente é o de quem detém **ao mesmo tempo** o banco e a chave. Recomenda-se ancorar periodicamente o último elo da cadeia em serviço externo (carimbo de tempo).

## 8. Verificação pública

Pelo QR Code ou pelo código impresso, qualquer pessoa vê: documento, número e versão, data de emissão, situação, signatários com data e hora, resultado de cada conferência e cancelamentos ou substituições. A página informa **o tipo de conferência**:

- **criptográfica** — hashes recalculados e evidências validadas pela assinatura Ed25519 do servidor;
- **documental** — hashes recalculados e conferidos;
- **cadastral** — assinatura anterior ao procedimento de evidências: conferida pelos registros, sem comprovante assinado;
- **falha** — algum registro não confere.

O PDF recebido pode ser conferido: atas por envio ao servidor (o arquivo é analisado e descartado); viagem/RTP por cálculo do hash no próprio aparelho, sem envio. CPF aparece mascarado; IP e e-mail não aparecem.

## 9. Proteção de dados pessoais

Dados tratados: nome, função, CPF, telefone (externos), IP, navegador, data e hora. Finalidade: comprovar autoria e integridade das assinaturas. Exibição pública: nome, função, CPF mascarado, data e hora. O pacote completo de evidências (com IP e navegador) só é exportado pela coordenação, com registro em auditoria. Senhas, códigos OTP, tokens e identificadores de sessão **não** são armazenados em texto: senhas ficam no provedor de autenticação; OTP e prova de verificação como HMAC/hash; a sessão como resumo truncado.

**Retenção (proposta, a aprovar)**: registros de assinatura e evidências pelo prazo de guarda dos documentos de prestação de contas do convênio, acrescido do prazo prescricional aplicável; descarte ou anonimização após esse prazo, mediante registro.

## 10. Procedimento de auditoria

1. Abrir a verificação pública pelo código (resultado imediato).
2. Baixar o **Comprovante técnico de assinaturas** (PDF): para cada signatário, método de autenticação, declaração aceita, hashes, número da evidência, encadeamento e resultado.
3. Solicitar à coordenação o **pacote de evidências** (JSON) e verificá-lo **sem acesso à plataforma**:
   `node scripts/verificar-evidencias.mjs evidencias.json chave-publica.pem`
   O verificador recalcula hashes, encadeamento e assinatura Ed25519 e aponta qualquer registro que não confira.
4. Toda exportação de evidências fica registrada no log de auditoria.

## 11. Exemplos

- Verificação pública de ata: `https://atualizaprojeto.vercel.app/verificar-documento/<código>`
- Comprovante técnico: `https://atualizaprojeto.vercel.app/api/public/evidence-report/<código>`
- Modelo de evidência (campos): procedimento, evento, documento (tipo, identificador, título, hash, versão, código), solicitação, signatário (ordem, nome, função, conta, CPF mascarado), autenticação (método, descrição, resumo e idade da sessão ou horário do OTP), declaração (versão, SHA-256 do texto, aceite), rede (IP, navegador), data e hora UTC, hash da assinatura.

[Anexar: um comprovante técnico de ata assinada após a implantação e o resultado do verificador offline.]

## 12. Matriz de requisitos e limitações

| Requisito | Situação |
|---|---|
| Vinculação inequívoca ao signatário (conta + CPF confirmado; externos: CPF + OTP) | **Demonstrado tecnicamente** |
| Dados de criação sob controle exclusivo, com elevado nível de confiança | **Parcial** — senha + sessão recente; falta segundo fator para quem tem conta |
| Detecção de qualquer modificação posterior (conteúdo, registros e evidências) | **Demonstrado tecnicamente** (hashes, encadeamento, Ed25519, travas, testes) |
| Manifestação expressa de vontade, versionada e registrada | **Demonstrado tecnicamente** (a partir de nov/2026) |
| Confirmação de e-mail das contas | **Pendente** |
| Segundo fator na assinatura com conta | **Pendente** |
| Carimbo de tempo de autoridade certificadora | **Pendente** (não implementado) |
| Chave de assinatura em serviço de gestão de chaves | **Pendente** (variável de ambiente) |
| Certificado ICP-Brasil (assinatura qualificada) | **Não se aplica** — o sistema não emite nem usa |
| Aceitação do meio pelas partes (MP 2.200-2, art. 10, § 2º) | **Depende de aceitação institucional** (FAPTO; UFT para documentos dirigidos a ela) |
| Atendimento ao item 3.3 do Manual da FAPTO (relatório do projeto) | **Não atendido** — exige "assinatura digital certificada" |
| Segregação de funções (Res. 138/2025) no Formulário 26 do próprio coordenador | **Depende de manifestação** — hoje ele assina sozinho como beneficiário e coordenador |
| Assinaturas anteriores a nov/2026 | Mantidas e verificáveis apenas em nível **cadastral**; nenhum controle novo é atribuído a elas |

## 13. Proposta de reconhecimento institucional

Solicita-se à FAPTO que se manifeste sobre:

1. a aceitação, nos termos do art. 10, § 2º, da MP nº 2.200-2/2001, das assinaturas eletrônicas do RTP para: (a) atas de reunião da equipe; (b) Formulário 26; (c) Relatório Técnico Parcial do bolsista (Formulário 9);
2. se o item 3.3 do Manual ("assinatura digital certificada") alcança apenas o relatório técnico do projeto ou também os documentos acima;
3. se a FAPTO exige ICP-Brasil, gov.br, assinatura no SEI ou credenciamento prévio de signatários para algum desses documentos;
4. como proceder quando o próprio coordenador é o beneficiário da diária (quem dá o "de acordo");
5. eventuais requisitos adicionais (segundo fator, carimbo de tempo, formato de arquivo).

A minuta do pedido está em `03-minuta-solicitacao-fapto.md`.

---
Fontes consultadas: Manual de Orientações da FAPTO (fapto.org.br, vigência agosto/2022); Resolução CONSUNI/UFT nº 138, de 22/05/2025 (cópia publicada em fapto.org.br); legislação citada. Recomenda-se confirmar a vigência desses documentos junto às instituições antes do envio.
