# Manual ilustrado e identidade de assinatura

Esta alteração disponibiliza o manual em `/ajuda` e `/manual/Manual-do-Usuario-RTP-Inteligente.pdf`, destaca a revisão do RTP pelo próprio signatário e acrescenta convidados externos nas atas. Mantém a diagramação, o manifesto, os hashes e o arquivo final dos mecanismos de assinatura existentes.

## Identidade e operação

- A administração confirma o CPF em **Configurações > Editar acesso**. O administrador também pode usar **Confirmar meu CPF**. O CPF é exclusivo de uma conta. Dados anteriores informados no primeiro uso não são promovidos automaticamente a identidade confirmada.
- Um membro entra na própria conta e só pode assinar o espaço atribuído ao seu login, com o CPF confirmado. A versão enviada ao servidor precisa corresponder à versão lida. Edição do RTP cria uma versão, retira eventual aprovação anterior e permanece permitida somente antes da primeira assinatura.
- Convidado sem conta: a organização cadastra nome, CPF e WhatsApp; o link individual vale por sete dias. A ata só é liberada após CPF correspondente e código de seis dígitos enviado ao telefone cadastrado. O código vale por cinco minutos, permite cinco tentativas e tem intervalo mínimo de um minuto entre envios. São admitidos até dez envios por link.
- A prova de confirmação é privada, em cookie `HttpOnly`, `SameSite=Strict`, `Secure` em HTTPS, com validade de dez minutos. A assinatura volta a conferir o CPF, consome a prova e usa o mecanismo das atas em paralelo. Cancelamento, substituição da ata e expiração impedem novas assinaturas.
- **Reenviar convites pendentes** reaproveita os links válidos e renova links expirados ou com limite de códigos esgotado, sem alterar assinaturas já registradas. A entrega do PDF final continua incluindo convidados que já assinaram, mesmo se o convite venceu depois.
- As tabelas de identidade e de acesso externo têm RLS e acesso revogado para `authenticated`. Tokens são armazenados com hash e cópia criptografada; códigos usam HMAC. CPF, e-mail e telefone dos convidados não entram no conteúdo público da ata. Os procedimentos usam os segredos já existentes; não exigem uma nova chave de provedor.

## Validação

- Suíte Vitest e build de produção; testes específicos de edição do RTP, versão desatualizada, CPF vinculado à conta, código de confirmação, expiração e prova de outro convidado.
- Migração 018 executada numa transação revertida na branch isolada `signatures-manual-20261105`, incluindo bloqueio de alteração depois da assinatura.
- `scripts/capturar-manual.mjs` exercita as telas reais com APIs simuladas, sem criar contas ou enviar mensagens reais. Inclui edição e assinatura do RTP, confirmação e assinatura externa, capturas e largura móvel.
- `scripts/validar-manual.mjs` confere 37 páginas, texto, limites, cópia pública idêntica, sumário e marcadores; renderiza páginas em `docs/manual/qa/`, pasta ignorada pelo Git.

## Publicação e retorno

1. Concluir as verificações e gerar o PDF a partir das figuras atualizadas.
2. Criar a implantação com `vercel deploy --prod --skip-domain --yes`, preservando o domínio anterior enquanto o build termina.
3. Aplicar somente a migração validada com `node scripts/aplicar-migracao-assinaturas.mjs --production`. O comando usa a conexão local sem imprimir credenciais, troca o host pooled pelo direto e registra a migração em transação.
4. Promover a implantação validada com `vercel promote <deployment-url> --yes`.
5. Conferir `/ajuda`, tipo e integridade do PDF baixado, cabeçalhos da assinatura externa e recusa de rotas privadas sem login.

Versão pública anterior identificada antes desta publicação: `https://atualizaprojeto-flqo4aq1y-jasalimas-projects.vercel.app`. Se necessário, promova a versão anterior; não remova automaticamente as tabelas ou as proteções de identidade. Uma reversão do código deve considerar que os CPFs continuam precisando da confirmação administrativa no banco.

A publicação usa um checkout de release separado, baseado em `2d08d12`, e inclui somente manual, design e assinaturas, conforme solicitado. O commit paralelo `b958888` (atualização em tempo real) não integra esta versão de produção. Nenhuma credencial ou arquivo de ambiente integra esta alteração.
