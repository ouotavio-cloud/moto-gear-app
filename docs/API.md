# API

Base: `/api`. Tudo em JSON. Fora `/saude`, `/auth/login` e as duas rotas de
`/auth/cadastro/*`, toda rota exige `Authorization: Bearer <token>`.

Erro vem sempre como `{ "erro": "mensagem em português" }` — a mensagem é feita
para ser mostrada ao usuário. Status 500 é o único genérico; o resto explica.

## Multi-oficina

Cada organização (oficina) é isolada das outras: todo dado — estoque,
clientes, caixa, OS — pertence a uma organização, e o token de sessão carrega
`organizacaoId` e `papel` (`chefe` ou `funcionario`). Quem cadastra uma
oficina nova vira o chefe dela; o chefe tem um código de convite (em
`/auth/organizacao`) que outras pessoas usam para entrar como funcionário da
mesma oficina.

## Sessão

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/saude` | Diz se o servidor está no ar e se a IA está configurada |
| `POST` | `/auth/login` | `{usuario, senha}` → `{token}` (30 dias) |
| `POST` | `/auth/cadastro/oficina` | `{usuario, senha, nomeOficina}` → cria a oficina e o usuário como chefe; já devolve `{token}` |
| `POST` | `/auth/cadastro/funcionario` | `{usuario, senha, codigoConvite}` → entra na oficina dona do código como funcionário; já devolve `{token}` |
| `GET` | `/auth/eu` | Quem está logado: `{usuario, papel}` |
| `GET` | `/auth/usuarios` | Lista `{usuario, papel, criado_em}` de todos os usuários da mesma oficina |
| `GET` | `/auth/organizacao` | `{nome, souChefe, codigoConvite}` — `codigoConvite` só vem preenchido para o chefe |
| `POST` | `/auth/organizacao/codigo` | Gera um novo código de convite (invalida o antigo). Só o chefe pode chamar — `403` para funcionário |
| `POST` | `/auth/senha` | `{senhaAtual, senhaNova}` |

Usuário com 3+ caracteres, senha com 6+ em ambas as rotas de cadastro.

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
