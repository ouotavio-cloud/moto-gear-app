import test from 'node:test';
import assert from 'node:assert/strict';
import { subirServidor, estado, criarProduto, criarCliente, USUARIO, SENHA, OFICINA } from './ajuda.js';

let servidor;
let api;

test.before(async () => {
  servidor = await subirServidor();
  api = servidor.api;
});

test.after(() => servidor.fechar());

/** Chamada autenticada crua, para testar com um token que não é o da sessão principal. */
async function apiComo(token, metodo, caminho, corpo) {
  const resposta = await fetch(`${servidor.base}/api${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
}

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

test('login válido devolve token utilizável e o papel de chefe', async () => {
  const { status, corpo } = await api('GET', '/auth/eu');
  assert.equal(status, 200);
  assert.equal(corpo.usuario, USUARIO);
  assert.equal(corpo.papel, 'chefe');
  assert.ok(SENHA);
});

/* ------------------------------ organizações ------------------------------ */

test('cadastro de oficina nova cria o chefe e já devolve token utilizável', async () => {
  const resposta = await fetch(`${servidor.base}/api/auth/cadastro/oficina`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'outro-chefe', senha: 'senha123', nomeOficina: 'Outra Oficina' })
  });
  assert.equal(resposta.status, 201);
  const { token } = await resposta.json();
  assert.ok(token);

  const eu = await apiComo(token, 'GET', '/auth/eu');
  assert.equal(eu.corpo.usuario, 'outro-chefe');
  assert.equal(eu.corpo.papel, 'chefe');
});

test('cadastro de oficina sem nome é recusado', async () => {
  const resposta = await fetch(`${servidor.base}/api/auth/cadastro/oficina`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'sem-oficina', senha: 'senha123', nomeOficina: '   ' })
  });
  assert.equal(resposta.status, 400);
});

test('cadastro recusa nome de usuário já existente', async () => {
  const resposta = await fetch(`${servidor.base}/api/auth/cadastro/oficina`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIO, senha: 'outrasenha', nomeOficina: 'Duplicada' })
  });
  assert.equal(resposta.status, 409);
});

test('cadastro recusa senha curta', async () => {
  const resposta = await fetch(`${servidor.base}/api/auth/cadastro/oficina`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'fulano', senha: '123', nomeOficina: 'Qualquer' })
  });
  assert.equal(resposta.status, 400);
});

test('chefe vê o código de convite da própria oficina', async () => {
  const { status, corpo } = await api('GET', '/auth/organizacao');
  assert.equal(status, 200);
  assert.equal(corpo.nome, OFICINA);
  assert.equal(corpo.souChefe, true);
  assert.ok(corpo.codigoConvite);
});

test('funcionário entra na oficina do chefe usando o código de convite', async () => {
  const { corpo: organizacao } = await api('GET', '/auth/organizacao');

  const resposta = await fetch(`${servidor.base}/api/auth/cadastro/funcionario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'novo-mecanico', senha: 'senha123', codigoConvite: organizacao.codigoConvite })
  });
  assert.equal(resposta.status, 201);
  const { token } = await resposta.json();

  const eu = await apiComo(token, 'GET', '/auth/eu');
  assert.equal(eu.corpo.usuario, 'novo-mecanico');
  assert.equal(eu.corpo.papel, 'funcionario');

  const org = await apiComo(token, 'GET', '/auth/organizacao');
  assert.equal(org.corpo.nome, OFICINA);
  assert.equal(org.corpo.souChefe, false);
  assert.equal(org.corpo.codigoConvite, null, 'funcionário não pode ver o código');
});

test('código de convite inválido é recusado', async () => {
  const resposta = await fetch(`${servidor.base}/api/auth/cadastro/funcionario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'intruso', senha: 'senha123', codigoConvite: 'CODIGOFALSO' })
  });
  assert.equal(resposta.status, 404);
});

test('só o chefe pode gerar um novo código de convite', async () => {
  const loginFuncionario = await fetch(`${servidor.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'novo-mecanico', senha: 'senha123' })
  });
  const { token } = await loginFuncionario.json();

  const negado = await apiComo(token, 'POST', '/auth/organizacao/codigo');
  assert.equal(negado.status, 403);

  const { status, corpo } = await api('POST', '/auth/organizacao/codigo');
  assert.equal(status, 200);
  assert.ok(corpo.codigoConvite);
});

test('chefe cadastra a chave Pix e todos da oficina passam a enxergá-la', async () => {
  const loginFuncionario = await fetch(`${servidor.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'novo-mecanico', senha: 'senha123' })
  });
  const { token } = await loginFuncionario.json();

  // Funcionário não pode alterar a chave.
  const negado = await apiComo(token, 'POST', '/auth/organizacao/pix', { chave: 'intruso@pix.com', nome: 'X', cidade: 'Y' });
  assert.equal(negado.status, 403);

  // Chefe salva a chave.
  const salvo = await api('POST', '/auth/organizacao/pix', { chave: 'oficina@pix.com', nome: 'Moto Gear', cidade: 'Sao Paulo' });
  assert.equal(salvo.status, 200);
  assert.equal(salvo.corpo.pix.chave, 'oficina@pix.com');

  // Funcionário lê a chave (precisa dela pra cobrar no balcão), mas o código de convite continua oculto.
  const org = await apiComo(token, 'GET', '/auth/organizacao');
  assert.equal(org.corpo.pix.chave, 'oficina@pix.com');
  assert.equal(org.corpo.pix.nome, 'Moto Gear');
  assert.equal(org.corpo.pix.cidade, 'Sao Paulo');
  assert.equal(org.corpo.codigoConvite, null);
});

test('lista de usuários mostra só quem está na mesma oficina', async () => {
  const semToken = await api('GET', '/auth/usuarios', undefined, { semToken: true });
  assert.equal(semToken.status, 401);

  const { status, corpo } = await api('GET', '/auth/usuarios');
  assert.equal(status, 200);
  const nomes = corpo.map((u) => u.usuario);
  assert.ok(nomes.includes(USUARIO));
  assert.ok(nomes.includes('novo-mecanico'));
  assert.ok(!nomes.includes('outro-chefe'), 'usuário de outra oficina não pode aparecer aqui');
});

test('uma oficina não vê nem edita os dados de outra', async () => {
  const loginOutro = await fetch(`${servidor.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'outro-chefe', senha: 'senha123' })
  });
  const { token: tokenOutro } = await loginOutro.json();

  const produto = await criarProduto(api, { nome: 'Exclusivo da Oficina Teste' });

  const { corpo: estadoOutro } = await apiComo(tokenOutro, 'GET', '/estado');
  assert.equal(estadoOutro.produtos.some((p) => p.id === produto.id), false, 'a outra oficina não pode ver essa peça');

  const tentativaEdicao = await apiComo(tokenOutro, 'PUT', `/produtos/${produto.id}`, { nome: 'Sequestrado', custo: 1, venda: 1 });
  assert.equal(tentativaEdicao.status, 404, 'nem consegue editar uma peça de outra oficina');
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
  const { status, corpo } = await api('POST', '/vendas', { itens: [{ tipo: 'produto', itemId: produto.id, qtd: 3 }] });

  assert.equal(status, 201);
  assert.equal(corpo.total, 90);

  const { produtos, transacoes } = await estado(api);
  assert.equal(produtos.find((p) => p.id === produto.id).qtd, 5);

  const venda = transacoes.find((t) => t.desc === 'Venda Balcão: 3x Filtro');
  assert.equal(venda.tipo, 'entrada');
  assert.equal(venda.valor, 90);
  assert.equal(venda.origem, 'venda');
});

test('venda acima do estoque é recusada e nada é baixado', async () => {
  const produto = await criarProduto(api, { nome: 'Corrente', custo: 50, venda: 120, qtd: 2 });
  const { status, corpo } = await api('POST', '/vendas', { itens: [{ tipo: 'produto', itemId: produto.id, qtd: 5 }] });

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

  const { corpo } = await api('POST', '/vendas', { itens: [{ tipo: 'servico', itemId: servico.id, qtd: 1 }] });
  // 40 de mão de obra + 2 unidades de óleo a 35.
  assert.equal(corpo.total, 110);

  const { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === oleo.id).qtd, 8);
});

test('cotação fixa o valor que será registrado mesmo se o preço mudar depois', async () => {
  const produto = await criarProduto(api, { nome: 'Óleo cotado', custo: 20, venda: 35, qtd: 4 });
  const cotada = await api('POST', '/vendas/cotacao', { itens: [{ tipo: 'produto', itemId: produto.id, qtd: 2 }] });
  assert.equal(cotada.status, 200);
  assert.equal(cotada.corpo.total, 70);
  assert.ok(cotada.corpo.cotacao);

  await api('PUT', `/produtos/${produto.id}`, { ...produto, venda: 50 });
  const confirmada = await api('POST', '/vendas', { cotacao: cotada.corpo.cotacao });
  assert.equal(confirmada.status, 201);
  assert.equal(confirmada.corpo.total, 70);

  const atual = await estado(api);
  assert.equal(atual.produtos.find((p) => p.id === produto.id).qtd, 2);
  assert.ok(atual.transacoes.some((t) => t.origem === 'venda' && t.valor === 70));
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

  const { status } = await api('POST', '/vendas', { itens: [{ tipo: 'servico', itemId: servico.id, qtd: 1 }] });
  assert.equal(status, 409);

  const { produtos } = await estado(api);
  assert.equal(produtos.find((p) => p.id === pastilha.id).qtd, 5, 'a pastilha não podia ter sido debitada');
  assert.equal(produtos.find((p) => p.id === parafuso.id).qtd, 1);
});

test('venda de balcão aceita peça e serviço juntos, soma o total e baixa tudo de uma vez', async () => {
  const oleo = await criarProduto(api, { nome: 'Óleo 20W50', custo: 15, venda: 35, qtd: 10 });
  const vela = await criarProduto(api, { nome: 'Vela de ignição', custo: 8, venda: 20, qtd: 6 });
  const { corpo: servico } = await api('POST', '/servicos', {
    nome: 'Troca de óleo',
    valor: 40,
    pecas: [{ produtoId: oleo.id, qtd: 2 }]
  });

  const { status, corpo } = await api('POST', '/vendas', {
    itens: [
      { tipo: 'servico', itemId: servico.id, qtd: 1 },
      { tipo: 'produto', itemId: vela.id, qtd: 2 }
    ]
  });

  assert.equal(status, 201);
  // Serviço: 40 + 2x35 = 110. Peça avulsa: 2x20 = 40. Total: 150.
  assert.equal(corpo.total, 150);

  const { produtos, transacoes } = await estado(api);
  assert.equal(produtos.find((p) => p.id === oleo.id).qtd, 8, 'óleo do serviço debitado');
  assert.equal(produtos.find((p) => p.id === vela.id).qtd, 4, 'vela avulsa debitada');

  const venda = transacoes.find((t) => t.valor === 150 && t.origem === 'venda');
  assert.ok(venda, 'lançamento único no caixa com o total combinado');
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

test('leitura por IA responde 503 quando nenhum provedor está configurado', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  const { status, corpo } = await api('POST', '/nota-fiscal/ler', { imagemBase64: 'abc' });
  assert.equal(status, 503);
  assert.match(corpo.erro, /ainda não está configurada/);
});

test('ajudante oferece ajuda local mesmo antes de configurar provedores externos', async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  const { status, corpo } = await api('POST', '/assistente/conversar', { mensagem: 'Como faço uma venda no Pix?', tela: 'tab-caixa' });
  assert.equal(status, 200);
  assert.match(corpo.resposta, /Caixa/);
  assert.equal(corpo._ia.provedor, 'ajuda-local');
});

test('ajudante prepara venda em conversa e só baixa estoque após confirmação', async () => {
  const produto = await criarProduto(api, { nome: 'Óleo Yamalube 20W50', custo: 20, venda: 35, qtd: 6 });

  const primeiro = await api('POST', '/assistente/venda', { mensagem: 'Venda óleo Yamalub' });
  assert.equal(primeiro.status, 200);
  assert.equal(primeiro.corpo.venda.fase, 'aguardando_quantidade');
  assert.equal(primeiro.corpo.venda.item.itemId, produto.id);
  assert.match(primeiro.corpo.resposta, /quantas unidades/i);

  let atual = await estado(api);
  assert.equal(atual.produtos.find((p) => p.id === produto.id).qtd, 6, 'conversa não pode baixar estoque');

  const segundo = await api('POST', '/assistente/venda', { mensagem: 'duas unidades', vendaAtual: primeiro.corpo.venda });
  assert.equal(segundo.status, 200);
  assert.equal(segundo.corpo.venda.fase, 'pronta');
  assert.deepEqual(segundo.corpo.rascunho.dados.itens.map(({ tipo, itemId, qtd }) => ({ tipo, itemId, qtd })), [
    { tipo: 'produto', itemId: produto.id, qtd: 2 }
  ]);
  assert.equal(segundo.corpo.rascunho.dados.total, 70);

  atual = await estado(api);
  assert.equal(atual.produtos.find((p) => p.id === produto.id).qtd, 6, 'rascunho ainda não pode baixar estoque');

  const confirmada = await api('POST', '/vendas', { itens: segundo.corpo.rascunho.dados.itens });
  assert.equal(confirmada.status, 201);
  atual = await estado(api);
  assert.equal(atual.produtos.find((p) => p.id === produto.id).qtd, 4);
});

test('ajudante recusa quantidade acima do estoque sem criar rascunho', async () => {
  const produto = await criarProduto(api, { nome: 'Óleo Motul 10W40', custo: 30, venda: 50, qtd: 1 });
  const resposta = await api('POST', '/assistente/venda', { mensagem: 'Venda 3 óleo Motul 10W40' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.rascunho, null);
  assert.match(resposta.corpo.resposta, /estoque/i);
  const atual = await estado(api);
  assert.equal(atual.produtos.find((p) => p.id === produto.id).qtd, 1);
});

test('ajudante não confunde uma marca ausente com outro óleo', async () => {
  await criarProduto(api, { nome: 'Óleo Yamalube 20W50', custo: 20, venda: 35, qtd: 6 });
  const resposta = await api('POST', '/assistente/venda', { mensagem: 'Venda óleo MarcaAusenteXYZ' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.rascunho, null);
  assert.match(resposta.corpo.resposta, /não encontrei/i);
});

test('ajudante verifica peças vinculadas antes de preparar venda de serviço', async () => {
  const oleo = await criarProduto(api, { nome: 'Óleo escasso', custo: 20, venda: 35, qtd: 1 });
  const { corpo: servico } = await api('POST', '/servicos', {
    nome: 'Troca premium',
    valor: 40,
    pecas: [{ produtoId: oleo.id, qtd: 1 }, { produtoId: oleo.id, qtd: 1 }]
  });
  const resposta = await api('POST', '/assistente/venda', { mensagem: 'Venda 1 troca premium' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.venda.item.itemId, servico.id);
  assert.equal(resposta.corpo.rascunho, null);
  assert.match(resposta.corpo.resposta, /peças suficientes/i);
});

test('transcrição de voz avisa quando o Groq ainda não foi configurado', async () => {
  delete process.env.GROQ_API_KEY;
  const { status, corpo } = await api('POST', '/assistente/transcrever', { audioBase64: 'YWJj' });
  assert.equal(status, 503);
  assert.match(corpo.erro, /transcrição por voz/);
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
