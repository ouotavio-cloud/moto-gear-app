# Modelo de dados

Definição em [`server/src/schema.sql`](../server/src/schema.sql). A conversão
entre a linha do banco e o formato que o app recebe fica em
[`server/src/mapeadores.js`](../server/src/mapeadores.js) — os nomes mudam de
`snake_case` para `camelCase` na fronteira.

Listas aninhadas (peças de um serviço, itens de uma OS) ficam em **JSONB**: são
sempre lidas junto com o registro pai e nunca consultadas isoladamente, então
normalizar traria junções sem ganho.

Multi-oficina: `produtos`, `servicos`, `clientes`, `fornecedores`, `ordens` e
`transacoes` têm todos uma coluna `organizacao_id` (FK para `organizacoes`).
Toda consulta do servidor filtra por ela — é o que isola os dados de uma
oficina das demais. Não aparece no formato que o app recebe (`mapeadores.js`
não a expõe).

## `organizacoes`

Uma oficina. `nome`, `codigo_convite` (único, usado por funcionários pra
entrar), `criado_em`.

## `produtos`

| Coluna | Tipo | No app | Observação |
|---|---|---|---|
| `id` | TEXT | `id` | UUID |
| `nome` | TEXT | `nome` | |
| `categoria`, `marca` | TEXT | idem | livres |
| `codigo_barras` | TEXT | `codigoBarras` | usado pelo leitor |
| `custo`, `venda` | NUMERIC(12,2) | idem | reais |
| `qtd` | INTEGER | `qtd` | estoque atual |
| `minimo` | INTEGER | `min` | abaixo disso vira alerta |
| `ativo` | BOOLEAN | `ativo` | exclusão é lógica |

## `servicos`

| Coluna | Tipo | No app | Observação |
|---|---|---|---|
| `valor` | NUMERIC | `valor` | mão de obra, **sem** as peças |
| `pecas` | JSONB | `pecas` | `[{produtoId, qtd}]` |

O preço exibido é `valor` + a soma do preço de **venda** das peças vinculadas.

## `clientes`

`nome`, `tel`, `placa` (gravada em maiúsculas), `moto`, `ativo`.

## `fornecedores`

`nome`, `cnpj`, `tel`, `vendedor`, `obs`, `ativo`. Não tem vínculo com peças — é
cadastro de contato.

## `ordens`

OS e orçamento na mesma tabela, separados por `tipo`.

| Coluna | Tipo | No app | Observação |
|---|---|---|---|
| `cliente_id` | TEXT | `clienteId` | referência a `clientes` |
| `tipo` | TEXT | — | `os` ou `orcamento` |
| `data` | TIMESTAMPTZ | `data` | criação; editar não altera |
| `itens` | JSONB | `itens` | `[{tipo, itemId, nome, qtd, total}]` |
| `valor_total` | NUMERIC | `valorTotal` | aceita desconto |
| `status` | TEXT | `status` | Pendente/Andamento/Concluída/Cancelada |
| `estoque_debitado` | BOOLEAN | `estoqueDebitado` | trava a baixa dupla |
| `valor_pago` | NUMERIC | `valorPago` | menor que o total = pendência |
| `tempo_gasto` | INTEGER | `tempoGasto` | minutos, para o R$/hora |

`itens` guarda `nome` e `total` **congelados** no momento em que a OS foi salva.
Mudar o preço de uma peça amanhã não reescreve o que foi cobrado ontem.

## `transacoes`

| Coluna | Tipo | No app | Observação |
|---|---|---|---|
| `descricao` | TEXT | `desc` | |
| `valor` | NUMERIC | `valor` | sempre positivo; o sinal vem de `tipo` |
| `tipo` | TEXT | `tipo` | `entrada` ou `saida` |
| `cliente_nome` | TEXT | `clienteNome` | nome copiado, não referência |
| `origem_detalhada` | TEXT | `origemDetalhada` | texto de auditoria |
| `origem` | TEXT | `origem` | `venda` ou `os`, para o ranking |
| `itens` | JSONB | `itens` | o que saiu, quando aplicável |

`cliente_nome` é cópia de propósito: o extrato precisa mostrar o nome que valia
no dia do lançamento, mesmo que o cliente seja renomeado ou excluído depois.

O saldo nunca é armazenado — é sempre `soma(entradas) − soma(saídas)`. Saldo
gravado é saldo que uma hora diverge.

## `usuarios`

`usuario`, `senha_hash` (scrypt no formato `sal:hash`), `organizacao_id`
(a oficina dele) e `papel` (`chefe` ou `funcionario`). O primeiro usuário é
criado no boot inicial a partir de `ADMIN_USUARIO`/`ADMIN_SENHA` — junto com
ele nasce a primeira organização, e ele vira o chefe dela.

## Compatibilidade com a versão 1

O backup do app antigo tem exatamente a forma que `POST /api/restaurar` espera,
incluindo o formato antigo codificado em Base64. Uma OS cujo cliente não existe
no arquivo é ignorada, porque violaria a chave estrangeira.
