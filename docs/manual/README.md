# Manual do usuário

- [Baixar o manual em PDF](./Manual-do-Usuario-RTP-Inteligente.pdf)
- [Editar o conteúdo em Markdown](./manual-do-usuario.md)

Edição ilustrada 1.1, de 05/11/2026, com 37 páginas, sete capturas das telas e dois fluxos vetoriais. Não contém dados reais de usuários nem credenciais. As capturas exercitam a aplicação com todas as APIs simuladas; não representam envios de mensagens ou assinaturas reais em produção.

Para gerar novamente, com as dependências do projeto instaladas:

```sh
node docs/manual/gerar-manual.mjs
```

O gerador utiliza o `pdfkit` já presente no projeto. Os separadores `<!-- page -->` controlam as páginas. Ao incluir capítulos, revise as referências de páginas no conteúdo. O sumário e a numeração do rodapé são gerados automaticamente; o gerador rejeita conteúdo que ultrapasse a área reservada de uma página.

O PDF possui texto selecionável, sumário com links internos e marcadores por capítulo. Atualize a data e a edição no conteúdo e no gerador ao publicar uma revisão.

Para atualizar as figuras, inicie uma versão local da aplicação na porta 3100 e execute `node scripts/capturar-manual.mjs`. O script exige o Chromium do Playwright (`npx playwright install chromium`), intercepta as APIs e utiliza somente dados fictícios. Depois execute o gerador. Uma cópia idêntica do PDF é gravada em `public/manual/` para download no ambiente publicado, pela página `/ajuda`.
