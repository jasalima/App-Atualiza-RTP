# Manual do usuário

- [Baixar o manual em PDF](./Manual-do-Usuario-RTP-Inteligente.pdf)
- [Editar o conteúdo em Markdown](./manual-do-usuario.md)

Edição 1.0, de 05/11/2026. O conteúdo foi conferido com as telas e regras do repositório. Não contém dados reais de usuários nem credenciais. A revisão foi feita pelo código; não representa uma execução de operações no ambiente de produção.

Para gerar novamente, com as dependências do projeto instaladas:

```sh
node docs/manual/gerar-manual.mjs
```

O gerador utiliza o `pdfkit` já presente no projeto. Os separadores `<!-- page -->` controlam as páginas. Ao incluir capítulos, revise as referências de páginas no conteúdo. O sumário e a numeração do rodapé são gerados automaticamente; o gerador rejeita conteúdo que ultrapasse a área reservada de uma página.

O PDF possui texto selecionável, sumário com links internos e marcadores por capítulo. Atualize a data e a edição no conteúdo e no gerador ao publicar uma revisão.
