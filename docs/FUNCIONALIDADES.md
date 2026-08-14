# Funcionalidades

Mapa de cada tela (aba inferior) para as funções JS que a implementam, dentro
de `app/www/index.html`. Use este documento para achar rápido "onde mexer"
quando for alterar alguma regra.

A navegação entre abas é feita por `switchTab(tabId, el)`, que troca a classe
`active` da `<main class="tab-content">` correspondente e chama a função de
`render*` daquela aba.

## 1. Início (Dashboard) — `#tab-inicio`

`renderDashboard()` → chama `renderCaixa()` + `renderEstoque()` e conta OS
abertas (`status` = Pendente ou Andamento).

Mostra:
- Caixa atual (saldo calculado, ver `MODELO_DE_DADOS.md`)
- Total de itens em estoque / OS abertas
- Alertas de estoque baixo (`qtd <= min`)
- Auditoria de transações (mesma lista renderizada no Caixa)

## 2. Estoque — `#tab-estoque`

- `renderEstoque()` — lista/filtra produtos ativos por busca de texto
- `abrirModalProduto()` / `editarProduto(id)` / `salvarProduto()` /
  `excluirProduto()` — CRUD (exclusão lógica)
- `addEstoqueRapido(id)` / `removeEstoqueRapido(id)` — botões `+`/`-` no card
  do produto, para ajuste manual rápido de 1 unidade

**Regra importante:** `addEstoqueRapido`/`removeEstoqueRapido` e
`salvarProduto` (quando a quantidade aumenta) **geram transações de
caixa automaticamente**:
- Criar produto com estoque inicial → transação de `saída` ("Estoque Inicial")
- Aumentar quantidade ao editar → transação de `saída` ("Ajuste Estoque")
- Botão `+` rápido → `saída` ("Reposição Rápida")
- Botão `-` rápido → `entrada` ("Venda Avulsa/Rápida") — ou seja, o botão `-`
  assume que tirar do estoque manualmente é uma venda de balcão, não uma
  baixa administrativa.

## 3. Serviços — `#tab-servicos`

- `renderServicos()` — lista serviços ativos, mostrando preço final = mão de
  obra (`s.valor`) + soma do preço de venda das peças vinculadas
- `abrirModalServico()` / `editarServico(id)` / `salvarServico()` /
  `excluirServico()`
- `addPecaServico()` / `remPecaServico(i)` — gerencia a lista temporária
  `pecasVinculadasTemp` antes de salvar

## 4. Caixa — `#tab-caixa`

- `renderCaixa()` — calcula saldo e lista todas as transações (mais recentes
  primeiro)
- `addTransacao(desc, valor, tipo, clienteNome, origemDetalhada)` — função
  central chamada de vários lugares do app (venda, despesa, OS concluída,
  ajustes de estoque) para registrar qualquer movimento de caixa
- `abrirModalVenda()` / `salvarVenda()` — venda avulsa de peça ou "serviço
  rápido" (fora do fluxo de OS), debita estoque na hora
- `abrirModalDespesa()` — usa `prompt()`/`alert()` nativos do navegador (não
  tem modal próprio) para lançar uma saída manual
- `exportarCaixaCSV()` — gera CSV com todas as transações e chama
  `baixarOuCompartilhar`
- `limparCaixa()` — apaga **todo** o histórico de transações (com
  `confirm()`), não afeta estoque/produtos

## 5. Clientes & OS — `#tab-clientes`

### Lista de clientes
`renderClientes()` — busca por nome ou placa; cada card mostra dois
indicadores calculados na hora:
- **OS Abertas**: quantas OS do cliente estão em `Pendente`/`Andamento`
- **Pendências financeiras**: OS `Concluída` com `valorPago < valorTotal`
  (soma o valor devido e destaca o card em vermelho)

`abrirModalCliente()` / `salvarCliente()` / `excluirCliente()` — CRUD básico.

### Central de OS (`abrirCentralOS()`)
Modal com **todas** as OS ativas de **todos** os clientes (não só do cliente
aberto), ordenadas por data mais recente. Clicar num item abre o perfil do
cliente e já abre a OS para edição (`editarOS`).

### Perfil do cliente (`abrirPerfilCliente(id)` / `setPCTab(tab, el)`)
Tela cheia com 3 sub-abas:
- **OS**: histórico de ordens de serviço do cliente
- **Orçamentos**: histórico de orçamentos (não geram movimento de caixa nem
  debitam estoque até virarem OS)
- **Financeiro**: lista de pendências (OS concluídas não pagas 100%), com
  botão `quitarPendencia(id)` para registrar o pagamento do restante — isso
  gera uma transação de `entrada` no caixa.

### Modal de OS/Orçamento (`initModalOS`, `addItemOS`, `salvarOS`, `editarOS`, `verificarStatusOS`, `transformarOrcamentoEmOS`)

Este é o fluxo mais complexo do app:

1. **Criar**: `initModalOS('os')` ou `initModalOS('orcamento')` zera o form;
   `addItemOS()` adiciona peças/serviços à lista temporária `itensOSTemp`,
   somando automaticamente o custo de peças vinculadas a serviços.
2. **Status da OS** (só existe para `os`, não para `orcamentos`):
   `Pendente → Andamento → Concluída` (ou `Cancelada` a qualquer momento).
   - **Estoque só é debitado ao entrar em `Andamento` ou `Concluída`**, uma
     única vez — controlado pela flag `estoqueDebitado`, checada em
     `salvarOS()`. Se não houver estoque suficiente para algum item, a função
     bloqueia com `alert()` e não salva.
   - **Ao concluir** (`status` muda para `Concluída` pela primeira vez): o
     campo "Valor Pago Agora" é somado a `valorPago`; se for menor que o
     total, o restante vira pendência financeira (aparece na aba Financeiro
     do cliente). O valor pago agora gera uma transação de `entrada` no caixa
     com a descrição dos itens (`origemDetalhada`).
   - Uma vez `Concluída` ou `Cancelada`, o campo de status fica desabilitado
     (`verificarStatusOS` trava edição further).
3. **Orçamento → OS**: `transformarOrcamentoEmOS()` clona os itens do
   orçamento para uma nova OS com `status: 'Pendente'` (não apaga o orçamento
   original).

## 6. Análises — `#tab-analises`

`setAnaliseTab(tab, el)` com 4 sub-abas, tudo calculado on-the-fly (nada é
pré-agregado/persistido):

- **Geral**: soma de todas as `entradas` vs. `saídas` em `transacoes`
- **Produtos**: ranking dos 10 produtos com mais estoque (não é ranking de
  mais vendidos — é literalmente `qtd` atual, cuidado ao interpretar)
- **Serviços**: lucratividade em R$/hora por serviço, calculada só a partir de
  OS com `status='Concluída'` que tenham `tempoGasto` preenchido; rateia o
  tempo entre os serviços da OS proporcionalmente ao valor de cada um
- **Fechamento Mensal**: agrupa `transacoes` por `data.slice(0,7)`
  (`YYYY-MM`), mostra entradas/saídas/lucro líquido por mês, mais recente
  primeiro

## 7. Fornecedores — `#tab-fornecedores`

CRUD simples: `renderFornecedores()`, `abrirModalFornecedor()`/
`editarFornecedor()`/`salvarFornecedor()`/`excluirFornecedor()` (exclusão
lógica). Sem vínculo com produtos/serviços — é só um cadastro de contato.

## 8. Importação de planilha (ícone no cabeçalho)

`importarPlanilha(event)` — lê `.xlsx`/`.xls`/`.csv` via SheetJS. Para cada
linha de cada aba da planilha:

1. Normaliza os nomes das colunas para minúsculas.
2. Decide se a linha é **cliente**, **produto** ou **serviço** olhando quais
   colunas existem (ex.: presença de `placa`/`telefone`/`whatsapp`/`moto` ⇒
   cliente; `custo`/`venda`/`categoria`/`marca`/`quantidade` ⇒ produto;
   `valor`/`mão de obra`/`peça vinculada` ⇒ serviço).
3. Se nenhuma coluna bater, usa o **nome da aba** como critério de fallback
   (aba com "cliente" no nome, "produto"/"peça"/"estoque", ou
   "serviço"/"servico").
4. Para serviço, tenta casar o nome da "peça vinculada" com um produto já
   existente pelo nome (case-insensitive).

Isso é heurístico — não há tela de mapeamento de colunas para o usuário
confirmar antes de importar.

## 9. Configurações — Backup e Restauração (ícone de engrenagem)

Ver `docs/ARQUITETURA.md` → seção "Backup / Restauração". Funções:
`fazerBackup()`, `restaurarBackup(event)`.

## 10. Compartilhamento/exportação de arquivos

`baixarOuCompartilhar(filename, content, mimeType)` — usada por
`exportarCaixaCSV()` e `fazerBackup()`. Ver `docs/ARQUITETURA.md` para a
cascata Capacitor → Web Share → download direto.
