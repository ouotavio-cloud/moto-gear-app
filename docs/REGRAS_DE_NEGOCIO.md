# Regras de negócio

O que o sistema faz com estoque e dinheiro, e por quê. Todas essas regras são
aplicadas em `server/src/negocio.js`, dentro de transação — o app só mostra o
resultado. Leia isto antes de mudar qualquer coisa que mexa em quantidade ou
valor.

## Ordem de serviço

O status é o que comanda tudo:

| Status | Estoque | Caixa |
|---|---|---|
| **Pendente** | intocado | nada |
| **Andamento** | peças saem (uma vez só) | nada |
| **Concluída** | peças saem, se ainda não saíram | entra o valor pago na hora |
| **Cancelada** | peças voltam, se tinham saído | nada |

Detalhes que não são óbvios:

- **A baixa acontece uma vez só.** A flag `estoque_debitado` guarda isso. Salvar
  a mesma OS em andamento cinco vezes não debita cinco vezes.
- **Cancelar devolve as peças**, e devolve pelos *itens gravados*, não pelos que
  a tela mandou agora: o que volta tem que ser o que realmente saiu.
- **OS concluída ou cancelada não aceita mais alteração.** O servidor recusa com
  409. É registro contábil, não rascunho.
- **Concluir lança no caixa só o valor efetivamente pago.** Se a OS é de R$ 250
  e o cliente pagou R$ 150, entram R$ 150 e os R$ 100 viram pendência do
  cliente, cobrável depois pelo botão de quitar.
- **O total é editável** para permitir desconto negociado. Os itens mantêm o
  preço de tabela; o total é o que foi combinado.

## Orçamento

Não toca em estoque nem em caixa. Aprovar cria uma **OS nova, pendente** e
preserva o orçamento original como histórico. A baixa só acontece quando essa OS
entrar em andamento — aprovar não reserva peça.

## Venda de balcão

Debita o estoque e credita o caixa na hora, numa transação só. Se o item é um
serviço, as peças vinculadas a ele também saem.

Validação e baixa acontecem em duas fases: primeiro confere tudo, depois aplica.
Sem isso, um serviço com três peças poderia debitar as duas primeiras e falhar
na terceira, deixando o estoque errado.

## Botões +/- do estoque

São ajuste rápido de balcão, e cada um gera lançamento no caixa:

- **`+`** → despesa ("Reposição Rápida"), pelo preço de **custo**. É reposição:
  saiu dinheiro para a peça entrar.
- **`−`** → receita ("Venda Avulsa/Rápida"), pelo preço de **venda**. Assume que
  tirar peça do estoque no balcão é venda.

Se a intenção for corrigir um erro de contagem, e não vender, use editar a peça —
mas atenção à regra seguinte.

## Cadastro e edição de peça

- Cadastrar com quantidade inicial lança uma **despesa** de `quantidade × custo`
  ("Estoque Inicial"): o dinheiro que já está parado na prateleira aparece no
  caixa.
- Editar **aumentando** a quantidade lança a diferença ("Ajuste Estoque").
  Diminuir não lança nada — perda e correção de contagem não são receita.

## Entrada por nota fiscal

1. A foto vai para o servidor, que chama a IA e devolve os itens **como
   rascunho**.
2. Você confere e corrige tudo na tela: quantidade, custo, e se cada item entra
   numa peça existente ou vira peça nova.
3. Só ao confirmar o estoque sobe.

A compra inteira vira **uma despesa só**, com o total da nota. Lançar item a
item duplicaria o valor da mesma compra no caixa.

Peça nova ganha preço de venda sugerido pela margem configurada (60% por
padrão) — é chute inicial para você ajustar, não recomendação de preço.

A IA erra: preço trocado, item faltando, quantidade errada. A tela de
conferência existe exatamente por isso, e nada é gravado antes dela.

## Exclusão

Nunca apaga de verdade: marca `ativo = false`. Uma OS de dois anos atrás
continua mostrando a peça que foi usada, mesmo que ela não seja mais vendida.

## Pendências financeiras

Uma pendência é uma OS **concluída** cujo `valor_pago` é menor que o
`valor_total`. O cliente com pendência aparece destacado em vermelho na lista, e
quitar registra a diferença como entrada no caixa. Não dá para quitar duas
vezes.

## Análises

- **Mais vendidos** soma as OS concluídas com as vendas de balcão. O fechamento
  de OS também gera transação, então só entram as transações marcadas como
  `origem: 'venda'` — senão a mesma peça contaria duas vezes.
- **Lucratividade por hora** só considera OS concluídas com tempo preenchido, e
  rateia o tempo entre os serviços daquela OS proporcionalmente ao valor de cada
  um. Sem tempo lançado, o serviço aparece sem R$/hora em vez de aparecer com
  número inventado.
