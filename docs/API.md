# API

Base: `/api`. Tudo em JSON. Fora `/saude` e `/auth/login`, toda rota exige
`Authorization: Bearer <token>`.

Erro vem sempre como `{ "erro": "mensagem em português" }` — a mensagem é feita
para ser mostrada ao usuário. Status 500 é o único genérico; o resto explica.

## Sessão

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/saude` | Diz se o servidor está no ar e se a IA está configurada |
| `POST` | `/auth/login` | `{usuario, senha}` → `{token}` (30 dias) |
| `GET` | `/auth/eu` | Quem está logado |
| `POST` | `/auth/senha` | `{senhaAtual, senhaNova}` |

## Estado

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/estado` | Tudo de uma vez: produtos, servicos, clientes, fornecedores, os, orcamentos, transacoes |

É o que o app chama depois de cada escrita.

## Cadastros

Mesma forma para `produtos`, `servicos`, `clientes` e `fornecedores`:

| Método | Rota |
|---|---|
| `POST` | `/produtos` |
| `PUT` | `/produtos/:id` |
| `DELETE` | `/produtos/:id` (exclusão lógica) |

## Estoque e caixa

| Método | Rota | Corpo |
|---|---|---|
| `POST` | `/produtos/:id/ajuste` | `{delta: 1 \| -1}` |
| `POST` | `/vendas` | `{tipo, itemId, qtd}` → `{total}` |
| `POST` | `/despesas` | `{desc, valor}` |
| `DELETE` | `/transacoes` | apaga o histórico do caixa |

## Ordens

| Método | Rota | Corpo |
|---|---|---|
| `POST` | `/ordens` | `{tipo, clienteId, itens, valorTotal?}` |
| `PUT` | `/ordens/:id` | `{tipo, itens, status?, valorPago?, tempoGasto?, valorTotal?}` |
| `POST` | `/orcamentos/:id/aprovar` | — |
| `POST` | `/os/:id/quitar` | → `{valorRecebido}` |

`itens` é `[{tipo: 'produto'|'servico', itemId, qtd}]`. Nome e preço de cada
item o servidor busca no banco: **o cliente manda o que quer, não quanto custa.**

Recusas esperadas: `409` para estoque insuficiente, OS já finalizada ou
pendência já quitada; `400` para dados inválidos.

## Nota fiscal

| Método | Rota | Corpo |
|---|---|---|
| `POST` | `/nota-fiscal/ler` | `{imagemBase64, mimeType}` → rascunho da nota |
| `POST` | `/nota-fiscal/entrada` | `{fornecedor, cnpj?, numero?, total, margem?, cadastrarFornecedor?, itens}` |

`itens` da entrada: `[{nome, qtd, custo, produtoId?}]`. Sem `produtoId`, a peça é
criada. Sem `GEMINI_API_KEY` no servidor, a leitura responde `503`.

## Backup e importação

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/backup` | Estado completo com `_meta` |
| `POST` | `/restaurar` | Substitui tudo; aceita backup da v1 |
| `POST` | `/importar` | `{produtos[], clientes[], servicos[]}` em lote |
