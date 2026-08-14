import test from 'node:test';
import assert from 'node:assert/strict';
import { subirServidor, estado, criarProduto, criarCliente, USUARIO, SENHA } from './ajuda.js';

let servidor;
let api;

test.before(async () => {
  servidor = await subirServidor();
  api = servidor.api;
});

test.after(() => servidor.fechar());

/* --------------------------------- sessão --------------------------------- */

test('rota protegida recusa quem não está logado', async () => {
  const { status } = await api('GET', '/estado', undefined, { semToken: true });
  assert.equal(status, 401);
});

test('login com senha errada é recusado', async () => {
  const resposta = await fetch(`${servidor.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIO, senha: 'errada' })
  });
  assert.equal(resposta.status, 401);
});

test('login válido devolve token utilizável', async () => {
  const { status, corpo } = await api('GET', '/auth/eu');
  assert.equal(status, 200);
  assert.equal(corpo.usuario, USUARIO);
  assert.ok(SENHA);
});

/* -------------------------------- cadastros ------------------------------- */

test('cadastrar peça com estoque inicial lança a compra como despesa', async () => {
  const produto = await criarProduto(api, { nome: 'Pastilha', custo: 20, venda: 45, qtd: 10 });
  assert.equal(produto.qtd, 10);
  assert.equal(produto.custo, 20);

  const { produtos, transacoes } = await estado(api);
  assert.ok(produtos.some((p) => p.id === produto.id));

  const lancamento = transacoes.find((t) => t.desc.includes('Estoque Inicial: Pastilha'));
  assert.equal(lancamento.tipo, 'saida');
  assert.equal(lancamento.valor, 200);
});

test('peça sem nome é recusada', async () => {
  const { status, corpo } = await api('POST', '/produtos', { nome: '   ', custo: 1 });
  assert.equal(status, 400);
  assert.match(corpo.erro, /Nome obrigatório/);
});

test('aumentar a quantidade ao editar lança apenas a diferença', async () => {
  const produto = await criarProduto(api, { nome: 'Vela', custo: 10, venda: 25, qtd: 2 });
  await api('PUT', `/produtos/${produto.id}`, { ...produto, qtd: 5 });

  const { transacoes } = await estado(api);
  const ajuste = transacoes.find((t) => t.desc === 'Ajuste Estoque: Vela');
  assert.equal(ajuste.valor, 30);
});

test('excluir é lógico: some da listagem mas o histórico continua', async () => {
  const produto = await criarProduto(api, { nome: 'Descartável', qtd: 0 });
  const { status } = await api('DELETE', `/produtos/${produto.id}`);
  assert.equal(status, 200);

  const { produtos } = await estado(api);
  assert.equal(produtos.some((p) => p.id === produto.id), false);
});

/* --------------------------------- vendas --------------------------------- */

test('venda de peça baixa o estoque e credita o caixa', async () => {
  const produto = await criarProduto(api, { nome: 'Filtro', custo: 12, venda: 30, qtd: 8 });
  const { status, corpo } = await api('POST', '/vendas', { tipo: 'produto', itemId: produto.id, qtd: 3 });

  assert.equal(status, 201);
  assert.equal(corpo.total, 90);

  const { produtos, transacoes } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 5);

  const venda = transacoes.find((t) => t.desc === 'Venda Balcão: Filtro');
  assert.equal(venda.tipo, 'entrada');
  assert.equal(venda.valor, 90);
  assert.equal(venda.origem, 'venda');
});

test('venda acima do estoque é recusada e nada é baixado', async () => {
  const produto = await criarProduto(api, { nome: 'Corrente', custo: 50, venda: 120, qtd: 2 });
  const { status, corpo } = await api('POST', '/vendas', { tipo: 'produto', itemId: produto.id, qtd: 5 });

  assert.equal(status, 409);
  assert.match(corpo.erro, /Estoque insuficiente/);

  const { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 2);
});

test('venda de serviço baixa as peças vinculadas', async () => {
  const oleo = await criarProduto(api, { nome: 'Óleo 20W50', custo: 15, venda: 35, qtd: 10 });
  const { corpo: servico } = await api('POST', '/servicos', {
    nome: 'Troca de óleo',
    valor: 40,
    pecas: [{ produtoId: oleo.id, qtd: 2 }]
  });

  const { corpo } = await api('POST', '/vendas', { tipo: 'servico', itemId: servico.id, qtd: 1 });
  // 40 de mão de obra + 2 unidades de óleo a 35.
  assert.equal(corpo.total, 110);

  const { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === oleo.id).qtd, 8);
});

test('serviço sem estoque suficiente não deixa baixa pela metade', async () => {
  const parafuso = await criarProduto(api, { nome: 'Parafuso', custo: 1, venda: 3, qtd: 1 });
  const pastilha = await criarProduto(api, { nome: 'Pastilha dianteira', custo: 30, venda: 70, qtd: 5 });
  const { corpo: servico } = await api('POST', '/servicos', {
    nome: 'Revisão de freio',
    valor: 50,
    pecas: [
      { produtoId: pastilha.id, qtd: 1 },
      { produtoId: parafuso.id, qtd: 4 }
    ]
  });

  const { status } = await api('POST', '/vendas', { tipo: 'servico', itemId: servico.id, qtd: 1 });
  assert.equal(status, 409);

  const { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === pastilha.id).qtd, 5, 'a pastilha não podia ter sido debitada');
  assert.equal(produtos.find((p) => p.id === parafuso.id).qtd, 1);
});

test('ajuste rápido soma e subtrai uma unidade com lançamento no caixa', async () => {
  const produto = await criarProduto(api, { nome: 'Relação', custo: 60, venda: 140, qtd: 1 });

  await api('POST', `/produtos/${produto.id}/ajuste`, { delta: 1 });
  await api('POST', `/produtos/${produto.id}/ajuste`, { delta: -1 });

  const { produtos, transacoes } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 1);
  assert.ok(transacoes.some((t) => t.desc === 'Reposição Rápida: Relação' && t.tipo === 'saida'));
  assert.ok(transacoes.some((t) => t.desc === 'Venda Avulsa/Rápida: Relação' && t.tipo === 'entrada'));
});

test('não deixa tirar unidade de estoque zerado', async () => {
  const produto = await criarProduto(api, { nome: 'Zerado', custo: 5, venda: 9, qtd: 0 });
  const { status } = await api('POST', `/produtos/${produto.id}/ajuste`, { delta: -1 });
  assert.equal(status, 409);
});

test('despesa manual entra como saída', async () => {
  const { status } = await api('POST', '/despesas', { desc: 'Aluguel', valor: 1500 });
  assert.equal(status, 201);

  const { transacoes } = await estado(api);
  const despesa = transacoes.find((t) => t.desc === 'Aluguel');
  assert.equal(despesa.tipo, 'saida');
  assert.equal(despesa.valor, 1500);
});

test('despesa sem valor é recusada', async () => {
  const { status } = await api('POST', '/despesas', { desc: 'Sem valor', valor: 0 });
  assert.equal(status, 400);
});

/* ----------------------------- ordens de serviço --------------------------- */

test('OS nova nasce pendente e não mexe no estoque', async () => {
  const cliente = await criarCliente(api, { nome: 'João' });
  const produto = await criarProduto(api, { nome: 'Cabo de embreagem', custo: 15, venda: 40, qtd: 6 });

  const { status, corpo: os } = await api('POST', '/ordens', {
    tipo: 'os',
    clienteId: cliente.id,
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 2 }]
  });

  assert.equal(status, 201);
  assert.equal(os.status, 'Pendente');
  assert.equal(os.estoqueDebitado, false);
  assert.equal(os.valorTotal, 80);

  const { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 6);
});

test('OS em andamento debita o estoque uma única vez', async () => {
  const cliente = await criarCliente(api, { nome: 'Maria' });
  const produto = await criarProduto(api, { nome: 'Pneu traseiro', custo: 150, venda: 320, qtd: 4 });

  const { corpo: os } = await api('POST', '/ordens', {
    tipo: 'os',
    clienteId: cliente.id,
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }]
  });

  const emAndamento = { tipo: 'os', itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }], status: 'Andamento' };
  await api('PUT', `/ordens/${os.id}`, emAndamento);
  await api('PUT', `/ordens/${os.id}`, emAndamento);

  const { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 3, 'só podia ter debitado uma vez');
});

test('concluir OS lança no caixa só o valor pago e deixa o resto como pendência', async () => {
  const cliente = await criarCliente(api, { nome: 'Pedro' });
  const produto = await criarProduto(api, { nome: 'Bateria', custo: 100, venda: 250, qtd: 3 });

  const { corpo: os } = await api('POST', '/ordens', {
    tipo: 'os',
    clienteId: cliente.id,
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }]
  });

  const { corpo: concluida } = await api('PUT', `/ordens/${os.id}`, {
    tipo: 'os',
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }],
    status: 'Concluída',
    valorPago: 150,
    tempoGasto: 45
  });

  assert.equal(concluida.status, 'Concluída');
  assert.equal(concluida.valorPago, 150);
  assert.equal(concluida.valorTotal, 250);
  assert.equal(concluida.tempoGasto, 45);

  const { transacoes } = await estado(api);
  const fechamento = transacoes.find((t) => t.desc.startsWith('Fechamento OS'));
  assert.equal(fechamento.valor, 150);
  assert.equal(fechamento.clienteNome, 'Pedro');
  assert.equal(fechamento.origem, 'os');
});

test('quitar pendência recebe o restante e não deixa cobrar de novo', async () => {
  const cliente = await criarCliente(api, { nome: 'Ana' });
  const produto = await criarProduto(api, { nome: 'Farol', custo: 40, venda: 100, qtd: 2 });

  const { corpo: os } = await api('POST', '/ordens', {
    tipo: 'os',
    clienteId: cliente.id,
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }]
  });
  await api('PUT', `/ordens/${os.id}`, {
    tipo: 'os',
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }],
    status: 'Concluída',
    valorPago: 30
  });

  const { status, corpo } = await api('POST', `/os/${os.id}/quitar`);
  assert.equal(status, 200);
  assert.equal(corpo.valorRecebido, 70);

  const repetido = await api('POST', `/os/${os.id}/quitar`);
  assert.equal(repetido.status, 409);
});

test('cancelar OS já debitada devolve as peças ao estoque', async () => {
  const cliente = await criarCliente(api, { nome: 'Carlos' });
  const produto = await criarProduto(api, { nome: 'Coroa', custo: 45, venda: 110, qtd: 5 });

  const { corpo: os } = await api('POST', '/ordens', {
    tipo: 'os',
    clienteId: cliente.id,
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 2 }]
  });
  await api('PUT', `/ordens/${os.id}`, {
    tipo: 'os',
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 2 }],
    status: 'Andamento'
  });

  let { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 3);

  await api('PUT', `/ordens/${os.id}`, {
    tipo: 'os',
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 2 }],
    status: 'Cancelada'
  });

  ({ produtos } = await estado(api));
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 5, 'as peças precisavam voltar');
});

test('OS finalizada não aceita mais alteração', async () => {
  const cliente = await criarCliente(api, { nome: 'Rita' });
  const produto = await criarProduto(api, { nome: 'Retrovisor', custo: 20, venda: 50, qtd: 4 });

  const itens = [{ tipo: 'produto', itemId: produto.id, qtd: 1 }];
  const { corpo: os } = await api('POST', '/ordens', { tipo: 'os', clienteId: cliente.id, itens });
  await api('PUT', `/ordens/${os.id}`, { tipo: 'os', itens, status: 'Concluída', valorPago: 50 });

  const { status } = await api('PUT', `/ordens/${os.id}`, { tipo: 'os', itens, status: 'Andamento' });
  assert.equal(status, 409);
});

test('OS aceita desconto no total sem alterar os itens', async () => {
  const cliente = await criarCliente(api, { nome: 'Desconto' });
  const produto = await criarProduto(api, { nome: 'Manete', custo: 10, venda: 60, qtd: 3 });

  const { corpo: os } = await api('POST', '/ordens', {
    tipo: 'os',
    clienteId: cliente.id,
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 2 }],
    valorTotal: 100
  });

  assert.equal(os.valorTotal, 100);
  assert.equal(os.itens[0].total, 120);
});

test('orçamento não mexe em estoque e vira OS ao ser aprovado', async () => {
  const cliente = await criarCliente(api, { nome: 'Orçamento' });
  const produto = await criarProduto(api, { nome: 'Amortecedor', custo: 90, venda: 220, qtd: 4 });

  const { corpo: orcamento } = await api('POST', '/ordens', {
    tipo: 'orcamento',
    clienteId: cliente.id,
    itens: [{ tipo: 'produto', itemId: produto.id, qtd: 2 }]
  });

  let { produtos, orcamentos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 4);
  assert.ok(orcamentos.some((o) => o.id === orcamento.id));

  const { status, corpo: novaOS } = await api('POST', `/orcamentos/${orcamento.id}/aprovar`);
  assert.equal(status, 201);
  assert.equal(novaOS.status, 'Pendente');
  assert.equal(novaOS.valorTotal, 440);

  ({ produtos } = await estado(api));
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 4, 'aprovar não debita, só a OS em andamento debita');
});

test('OS sem itens é recusada', async () => {
  const cliente = await criarCliente(api, { nome: 'Vazio' });
  const { status } = await api('POST', '/ordens', { tipo: 'os', clienteId: cliente.id, itens: [] });
  assert.equal(status, 400);
});

/* ------------------------------- nota fiscal ------------------------------- */

test('entrada por nota soma no estoque, cria peça nova e lança uma despesa só', async () => {
  const existente = await criarProduto(api, { nome: 'Kit relação', custo: 80, venda: 180, qtd: 2 });

  const { status, corpo } = await api('POST', '/nota-fiscal/entrada', {
    fornecedor: 'Distribuidora Moto Peças',
    numero: '12345',
    total: 500,
    margem: 50,
    cadastrarFornecedor: true,
    itens: [
      { nome: 'Kit relação', qtd: 3, custo: 85, produtoId: existente.id },
      { nome: 'Vela NGK', qtd: 10, custo: 12 }
    ]
  });

  assert.equal(status, 201);
  assert.equal(corpo.aplicados.length, 2);

  const { produtos, transacoes, fornecedores } = await estado(api);

  const kit = produtos.find((p) => p.id === existente.id);
  assert.equal(kit.qtd, 5);
  assert.equal(kit.custo, 85, 'o custo precisa acompanhar a nota mais recente');

  const vela = produtos.find((p) => p.nome === 'Vela NGK');
  assert.equal(vela.qtd, 10);
  assert.equal(vela.venda, 18, 'venda sugerida = custo + 50% de margem');

  const compras = transacoes.filter((t) => t.desc.startsWith('Compra de peças'));
  assert.equal(compras.length, 1, 'a nota inteira é uma despesa só');
  assert.equal(compras[0].valor, 500);

  assert.ok(fornecedores.some((f) => f.nome === 'Distribuidora Moto Peças'));
});

test('leitura por IA responde 503 quando o servidor não tem chave configurada', async () => {
  delete process.env.GEMINI_API_KEY;
  const { status, corpo } = await api('POST', '/nota-fiscal/ler', { imagemBase64: 'abc' });
  assert.equal(status, 503);
  assert.match(corpo.erro, /GEMINI_API_KEY/);
});

/* --------------------------- backup e importação --------------------------- */

test('backup e restauração devolvem o sistema ao mesmo estado', async () => {
  const { corpo: backup } = await api('GET', '/backup');
  assert.ok(backup.produtos.length > 0);
  const antes = backup.produtos.length;

  await api('POST', '/produtos', { nome: 'Peça temporária', custo: 1, venda: 2, qtd: 1 });
  const { corpo: restaurado } = await api('POST', '/restaurar', backup);
  assert.ok(restaurado.total > 0);

  const { produtos } = await estado(api);
  assert.equal(produtos.length, antes);
  assert.equal(produtos.some((p) => p.nome === 'Peça temporária'), false);
});

test('restaurar arquivo que não é backup é recusado', async () => {
  const { status } = await api('POST', '/restaurar', { qualquer: 'coisa' });
  assert.equal(status, 400);
});

test('importação em lote cria peças, clientes e serviços', async () => {
  const { status, corpo } = await api('POST', '/importar', {
    produtos: [{ nome: 'Importada A', custo: 5, venda: 12, qtd: 3 }],
    clientes: [{ nome: 'Cliente Importado', placa: 'imp1a23' }],
    servicos: [{ nome: 'Serviço Importado', valor: 25 }]
  });

  assert.equal(status, 201);
  assert.equal(corpo.total, 3);

  const { produtos, clientes, servicos } = await estado(api);
  assert.ok(produtos.some((p) => p.nome === 'Importada A'));
  assert.ok(clientes.some((c) => c.placa === 'IMP1A23'), 'a placa é normalizada em maiúsculas');
  assert.ok(servicos.some((s) => s.nome === 'Serviço Importado'));
});
