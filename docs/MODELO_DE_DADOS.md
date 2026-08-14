# Modelo de Dados

Todo o estado do app fica num único objeto global `db`, inicializado assim
(ver `app/www/index.html`, variável `db` no topo do `<script>`):

```js
let db = { produtos: [], servicos: [], clientes: [], os: [], orcamentos: [], transacoes: [], fornecedores: [] };
```

Cada chave é persistida separadamente (`saveDB('produtos')`, `saveDB('os')`,
etc. — ver `docs/ARQUITETURA.md`). Não há relação formal (FK) — os vínculos
são feitos por `id` (string, geralmente `Date.now().toString()`), sem checagem
de integridade além do que o próprio código garante.

## `produtos` (Estoque)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | timestamp da criação |
| `nome` | string | nome da peça |
| `categoria` | string | livre |
| `marca` | string | livre |
| `custo` | number | preço de custo (R$) |
| `venda` | number | preço de venda (R$) |
| `qtd` | number | quantidade em estoque |
| `min` | number | estoque mínimo — abaixo disso vira alerta no dashboard |
| `ativo` | boolean | exclusão é lógica (`ativo=false`), nunca remove do array |

## `servicos` (Serviços)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | |
| `nome` | string | |
| `valor` | number | valor da mão de obra (R$), **não inclui peças** |
| `pecas` | `{produtoId, qtd}[]` | peças vinculadas ao serviço; o preço final exibido soma `valor` + custo de venda dessas peças |
| `ativo` | boolean | exclusão lógica |

## `clientes`

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | |
| `nome` | string | |
| `tel` | string | WhatsApp |
| `placa` | string | sempre salva em maiúsculas |
| `moto` | string | modelo da moto |
| `ativo` | boolean | (`undefined`/`true` = ativo; só fica `false` quando excluído) |

## `os` (Ordens de Serviço) e `orcamentos`

Mesmo formato de objeto; a diferença é só em qual array (`db.os` vs.
`db.orcamentos`) e no ciclo de vida (orçamento não debita estoque nem tem
`status`/pagamento até virar OS).

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | |
| `clienteId` | string | FK para `clientes` |
| `data` | string (ISO) | data de criação |
| `itens` | `{tipo, itemId, nome, qtd, total}[]` | `tipo` é `'produto'` ou `'servico'`; `total` já vem calculado (inclui peças vinculadas se for serviço) |
| `valorTotal` | number | soma dos itens, editável manualmente no modal |
| `status` | string | só existe em `os`: `'Pendente'` \| `'Andamento'` \| `'Concluída'` \| `'Cancelada'` |
| `estoqueDebitado` | boolean | trava para não debitar estoque duas vezes (ver regra em `FUNCIONALIDADES.md`) |
| `valorPago` | number | acumulado; se `< valorTotal` quando `status='Concluída'`, gera pendência financeira |
| `tempoGasto` | number | minutos, usado só na análise de lucratividade por hora |

## `transacoes` (Caixa)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | |
| `desc` | string | descrição livre |
| `valor` | number | sempre positivo; o sinal vem de `tipo` |
| `tipo` | `'entrada'` \| `'saida'` | |
| `data` | string (ISO) | |
| `clienteNome` | string | nome "congelado" no momento (não é FK, é snapshot — se o cliente for renomeado depois, a transação antiga mantém o nome antigo) |
| `origemDetalhada` | string | texto livre explicando a origem (ex.: "Venda Balcão Rápida", itens de uma OS concluída) |

O saldo do caixa é sempre **calculado on-the-fly**: `soma(entradas) -
soma(saídas)` sobre todo o array `transacoes` — não existe campo de saldo
persistido separadamente.

## `fornecedores`

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string | |
| `nome` | string | |
| `cnpj` | string | |
| `tel` | string | |
| `vendedor` | string | vendedor responsável |
| `obs` | string | observações livres |
| `ativo` | boolean | exclusão lógica |

## Convenções gerais

- **IDs**: `Date.now().toString()` na maior parte do app; na importação de
  planilha (`importarPlanilha`) usa `Date.now()+Math.random()...` para evitar
  colisão quando várias linhas são importadas na mesma tick.
- **Exclusão é sempre lógica** (`ativo = false`), nunca `splice`/remoção do
  array — histórico e vínculos antigos (ex.: uma OS antiga referenciando um
  produto excluído) continuam íntegros.
- **Sem validação de schema**: tudo é JS solto, sem TypeScript nem checagem em
  runtime além dos `if(!nome) return showToast(...)` pontuais.
