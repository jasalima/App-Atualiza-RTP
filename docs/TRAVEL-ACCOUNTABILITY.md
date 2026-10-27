# Prestação de contas de diárias e passagens

A seção `/travel` é independente dos RTPs e usa o Formulário 26 fornecido como referência. Nome, função, telefone, e-mail e título do projeto vêm do cadastro. Não reutiliza o nome, contato, convênio ou viagem do exemplo. Campos ausentes permanecem em branco; origem, destino, saída, retorno, pagamento da diária e descrição ficam sempre em branco. O DOCX é editável e o PDF se destina à impressão e preenchimento manual.

## Instalação

1. Execute `npm run db:migrate` para aplicar a migração `006_travel_accountability.sql`, seguindo o procedimento habitual do ambiente. Atualize o cache da Neon Data API após adicionar as colunas.
2. Cadastre telefone com DDI e DDD e e-mail dos membros. O campo de função e o título do projeto também devem estar atualizados.
3. Configure `EVOLUTION_API_URL` com a URL HTTPS do seu servidor Evolution API v2 e `EVOLUTION_API_KEY` com a chave administrativa, somente no servidor. A chave administrativa é usada para provisionar conexões, nunca enviada ao navegador.
4. Opcionalmente defina `WHATSAPP_CREDENTIAL_SECRET` com pelo menos 32 caracteres. Caso ausente, usa `NEON_AUTH_COOKIE_SECRET`. Guarde o segredo: trocá-lo exige recadastrar as conexões existentes.
5. Em “Diárias e passagens” → “Conexão WhatsApp”, cada usuário seleciona “Conectar meu WhatsApp” e escaneia o QR Code. A instância é criada automaticamente com nome `Gesproject-<UUID do projeto>-<hash do usuário>`, estável e exclusivo para o vínculo. O pareamento exige ação no celular do proprietário.
6. Novos usuários cadastrados pela aplicação recebem uma instância individual. Se o provedor estiver indisponível, o cadastro continua válido e a conexão fica pendente: coordenação/administração pode usar “Preparar conexões dos usuários do projeto” para tentar novamente. O usuário também pode preparar a própria conexão. Contas revogadas são excluídas do provisionamento do projeto.

## Isolamento e envio

As rotas conferem a sessão, revogação, troca de senha pendente e acesso ao projeto. Bolsistas só geram/enviam o próprio termo. A consulta do membro exige correspondência ao projeto e ignora registros excluídos. A conexão é selecionada pelo usuário autenticado e projeto, nunca por identificador de usuário ou instância fornecido pelo navegador. Consultas de estado, pareamento e envios usam apenas a chave individual, sem fallback administrativo. Chaves individuais são aleatórias, cifradas com AES-256-GCM e vinculadas ao usuário/projeto; as tabelas de conexão e controle de envios não são acessíveis pela Data API.

O servidor reserva a chave no banco antes de criar a instância. Chamadas concorrentes e novas tentativas reutilizam a chave vencedora e o nome determinístico. Instâncias já existentes com chave diferente são recusadas; conexões antigas fora do padrão Gesproject não são usadas para envio. O fluxo não exclui, desconecta ou reconfigura instâncias de outras aplicações. Novas instâncias não sincronizam histórico completo, não marcam mensagens como lidas e não registram integrações de webhook, RabbitMQ, SQS ou websocket. Os objetos dessas integrações são omitidos: algumas versões da Evolution ativam a integração quando o objeto está presente, mesmo com enabled:false. Configurações globais do servidor Evolution devem ser administradas separadamente.

O QR Code aparece somente na sessão do próprio usuário/projeto. O código é descartado ao fechar a janela, após 60 segundos ou ao confirmar o pareamento; as respostas usam `Cache-Control: private, no-store`. A tela consulta o estado a cada oito segundos enquanto a janela está aberta. Gerar um novo código exige ação explícita.

O botão WhatsApp pede a conferência do destinatário cadastrado e envia apenas o documento gerado pelo servidor, em PDF ou DOCX, via `POST /message/sendMedia/{instance}`. Não recebe arquivo, URL de mídia, mensagem livre ou destinatário arbitrário do navegador. Envia o arquivo em base64, sem disponibilizar link público. Requisições de escrita exigem mesma origem.

Referências do provedor: [criação e conexão de instâncias](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/controllers/instance.controller.ts), [envio de mídia](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/integrations/channel/evolution/evolution.channel.service.ts).

Cada tentativa registra solicitante, projeto, membro, identificador e estado. Uma janela de 30 segundos por usuário/projeto e uma chave única por solicitação reduzem duplicações. Em falha ou timeout, o envio fica incerto: confira o WhatsApp antes de repetir. “Aceito” indica aceitação HTTP pelo provedor, não confirmação de entrega ao aparelho. Não há repetição automática.

## Verificação

Execute `npm run check` e `npm test`. Antes de liberar o envio em produção, configure uma instância de teste e confira PDF e DOCX recebidos; a integração requer servidor Evolution disponível e instância pareada. Teste duas contas/projetos e um bolsista para verificar separação e recusa de acesso cruzado. O desenvolvimento não dispara documentos para colaboradores.
