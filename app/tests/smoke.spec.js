import { test, expect } from '@playwright/test';
import {
  abrirLogado,
  limparServidor,
  cadastrarProduto,
  cadastrarCliente,
  irPara,
  botaoDaAba,
  estado,
  coletarErros,
  abrirConfig,
  USUARIO,
  SENHA
} from './helpers.js';

let token;

test.beforeEach(async ({ request, baseURL }) => {
  token = await limparServidor(request, baseURL);
});

/* --------------------------------- login ---------------------------------- */

test('sem sessão o app mostra a tela de login', async ({ page }) => {
  const erros = coletarErros(page);
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-pronto', 'sim');
  await expect(page.locator('#tela-login')).toHaveClass(/active/);
  expect(erros).toEqual([]);
});

test('login com senha errada mostra o motivo e não entra', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.fill('#login-servidor', baseURL);
  await page.fill('#login-usuario', USUARIO);
  await page.fill('#login-senha', 'errada');
  await page.locator('#tela-login').getByRole('button', { name: /Entrar/ }).click();

  await expect(page.locator('#login-erro')).toContainText('incorretos');
  await expect(page.locator('#tela-login')).toHaveClass(/active/);
});

test('login correto abre o app', async ({ page, baseURL }) => {
  const erros = coletarErros(page);
  await page.goto('/');
  await page.fill('#login-servidor', baseURL);
  await page.fill('#login-usuario', USUARIO);
  await page.fill('#login-senha', SENHA);
  await page.locator('#tela-login').getByRole('button', { name: /Entrar/ }).click();

  await expect(page.locator('#tela-login')).not.toHaveClass(/active/);
  await expect(page.locator('#dash-saldo')).toHaveText('R$ 0,00');
  expect(erros).toEqual([]);
});

test('cadastro de oficina nova abre o app já logado como chefe', async ({ page, baseURL }) => {
  const erros = coletarErros(page);
  await page.goto('/');
  await page.locator('#login-troca-botao').click();
  await expect(page.locator('#login-confirmar-linha')).toBeVisible();
  await expect(page.locator('#login-nome-oficina-linha')).toBeVisible();

  await page.fill('#login-servidor', baseURL);
  await page.fill('#login-usuario', 'novo-chefe');
  await page.fill('#login-senha', 'senha123');
  await page.fill('#login-senha-confirmar', 'senha123');
  await page.fill('#login-nome-oficina', 'Oficina do Zé');
  await page.locator('#tela-login').getByRole('button', { name: /Criar conta/ }).click();

  await expect(page.locator('#tela-login')).not.toHaveClass(/active/);
  await expect(page.locator('#dash-saldo')).toHaveText('R$ 0,00');
  expect(erros).toEqual([]);
});

test('cadastro com senhas diferentes mostra erro e não envia nada', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.locator('#login-troca-botao').click();

  await page.fill('#login-servidor', baseURL);
  await page.fill('#login-usuario', 'outro-mecanico');
  await page.fill('#login-senha', 'senha123');
  await page.fill('#login-senha-confirmar', 'diferente');
  await page.locator('#tela-login').getByRole('button', { name: /Criar conta/ }).click();

  await expect(page.locator('#login-erro')).toContainText('coincidem');
  await expect(page.locator('#tela-login')).toHaveClass(/active/);
});

test('cadastro por código de convite entra na oficina do chefe', async ({ page, baseURL, browser }) => {
  await abrirLogado(page, baseURL, token);
  await abrirConfig(page);
  const codigoLocator = page.locator('#cfg-codigo-convite');
  await expect(codigoLocator).toContainText(/\w/); // espera o fetch assíncrono preencher o código
  const codigo = (await codigoLocator.textContent()).trim();
  await page.locator('#modal-config').getByRole('button', { name: 'Fechar configurações' }).click();

  // Contexto isolado: simula um segundo aparelho, sem herdar a sessão do chefe.
  const contexto2 = await browser.newContext();
  const pagina2 = await contexto2.newPage();
  await pagina2.goto('/');
  await pagina2.locator('#login-troca-botao').click();
  await pagina2.locator('#login-tipo-funcionario').click();
  await expect(pagina2.locator('#login-codigo-convite-linha')).toBeVisible();

  await pagina2.fill('#login-servidor', baseURL);
  await pagina2.fill('#login-usuario', 'funcionario-convidado');
  await pagina2.fill('#login-senha', 'senha123');
  await pagina2.fill('#login-senha-confirmar', 'senha123');
  await pagina2.fill('#login-codigo-convite', codigo);
  await pagina2.locator('#tela-login').getByRole('button', { name: /Criar conta/ }).click();

  await expect(pagina2.locator('#tela-login')).not.toHaveClass(/active/);
  await contexto2.close();
});

test('código de convite inválido mostra erro e não entra', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.locator('#login-troca-botao').click();
  await page.locator('#login-tipo-funcionario').click();

  await page.fill('#login-servidor', baseURL);
  await page.fill('#login-usuario', 'intruso');
  await page.fill('#login-senha', 'senha123');
  await page.fill('#login-senha-confirmar', 'senha123');
  await page.fill('#login-codigo-convite', 'CODIGOFALSO');
  await page.locator('#tela-login').getByRole('button', { name: /Criar conta/ }).click();

  await expect(page.locator('#login-erro')).toContainText('inválido');
  await expect(page.locator('#tela-login')).toHaveClass(/active/);
});

/* -------------------------------- navegação -------------------------------- */

test('navega por todas as abas sem erro', async ({ page, baseURL }) => {
  const erros = await abrirLogado(page, baseURL, token);

  await expect(page.locator('.bottom-nav .nav-item')).toHaveCount(4);
  await irPara(page, 'Operações');
  await expect(page.locator('#tab-operacoes')).toContainText('Produtos e estoque');
  await expect(page.locator('#tab-operacoes')).toContainText('Serviços');
  await expect(page.locator('#tab-operacoes')).toContainText('Fornecedores');

  for (const [rotulo, id] of [
    ['Estoque', 'tab-estoque'],
    ['Serviços', 'tab-servicos'],
    ['Caixa', 'tab-caixa'],
    ['Clientes', 'tab-clientes'],
    ['Fornec.', 'tab-fornecedores'],
    ['Análises', 'tab-analises'],
    ['Início', 'tab-inicio']
  ]) {
    await irPara(page, rotulo);
    await expect(page.locator(`#${id}`)).toHaveClass(/active/);
  }
  expect(erros).toEqual([]);
});

test('ajudante prepara serviço como rascunho e abre formulário para confirmação', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await page.route('**/api/assistente/conversar', (rota) => rota.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      resposta: 'Preparei o serviço. Confira antes de salvar.',
      sugestoes: [],
      rascunho: { tipo: 'servico', dados: { nome: 'Troca de óleo Motul', valor: 45 } },
      _ia: { provedor: 'groq' }
    })
  }));

  await page.getByRole('button', { name: 'Abrir ajudante Moto Gear' }).click();
  await expect(page.locator('#modal-assistente')).toHaveClass(/active/);
  await page.fill('#assistente-input', 'Cadastre troca de óleo Motul por 45 reais');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(page.locator('#assistente-rascunho')).toContainText('Troca de óleo Motul');
  await page.getByRole('button', { name: /Revisar no formulário/ }).click();

  await expect(page.locator('#modal-servico')).toHaveClass(/active/);
  await expect(page.locator('#assistente-rascunho')).toBeHidden();
  await expect(page.locator('#serv-nome')).toHaveValue('Troca de óleo Motul');
  await expect(page.locator('#serv-valor')).toHaveValue('45');
});

/* --------------------------------- estoque --------------------------------- */

test('cadastrar peça grava no servidor e lança a compra no caixa', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Pastilha de freio', custo: 20, venda: 45, qtd: 10 });

  await expect(page.locator('#lista-estoque')).toContainText('Pastilha de freio');

  const { produtos, transacoes } = await estado(page);
  expect(produtos).toHaveLength(1);
  expect(produtos[0]).toMatchObject({ nome: 'Pastilha de freio', qtd: 10, custo: 20, venda: 45 });
  expect(transacoes[0]).toMatchObject({ tipo: 'saida', valor: 200 });

  await irPara(page, 'Início');
  await expect(page.locator('#dash-itens')).toHaveText('10');
  await expect(page.locator('#dash-saldo')).toHaveText('-R$ 200,00');
});

test('os botões +/- ajustam o estoque na hora', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Vela', custo: 10, venda: 25, qtd: 3 });

  await page.getByRole('button', { name: 'Adicionar uma unidade de Vela' }).click();
  await expect(page.locator('#lista-estoque')).toContainText('4');

  await page.getByRole('button', { name: 'Remover uma unidade de Vela' }).click();
  await expect(page.locator('#lista-estoque')).toContainText('3');

  const { produtos } = await estado(page);
  expect(produtos[0].qtd).toBe(3);
});

test('alerta de estoque baixo aparece no início', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Cabo acelerador', custo: 8, venda: 20, qtd: 1, min: 2 });

  await irPara(page, 'Início');
  await expect(page.locator('#dash-alertas')).toContainText('Cabo acelerador');
  await expect(page.locator('#dash-alertas')).toContainText('Restam: 1');
});

test('nome com aspas e sinal de maior não quebra a tela', async ({ page, baseURL }) => {
  const erros = await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Kit "reforçado" <novo>' });

  await expect(page.locator('#lista-estoque')).toContainText('Kit "reforçado" <novo>');
  expect(erros).toEqual([]);
});

/* ---------------------------------- caixa ---------------------------------- */

test('venda de balcão baixa o estoque e credita o caixa', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Filtro de óleo', custo: 12, venda: 30, qtd: 8 });

  await irPara(page, 'Caixa');
  await botaoDaAba(page, 'caixa', /Nova venda/i).click();
  await page.fill('#venda-add-qtd', '3');
  await page.locator('#modal-venda button', { hasText: 'Adicionar' }).click();
  await expect(page.locator('#lista-itens-venda')).toContainText('Filtro de óleo');
  await page.locator('#modal-venda').getByRole('button', { name: 'Dinheiro' }).click();
  await expect(page.locator('#modal-venda')).not.toHaveClass(/active/);

  // 8 unidades a 12 de custo saíram como despesa; a venda soma 90 de entrada.
  await expect(page.locator('#caixa-saldo')).toHaveText('-R$ 6,00');

  const { produtos } = await estado(page);
  expect(produtos[0].qtd).toBe(5);
});

test('maquininha recebe valor, crédito e parcelamento antes de registrar a venda', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    globalThis._plugPagCalls = [];
    globalThis.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        PlugPag: {
          listarDispositivos: async () => ({
            selecionado: 'AA:BB:CC:DD:EE:FF',
            dispositivos: [{ id: 'AA:BB:CC:DD:EE:FF', nome: 'Moderninha Teste', selecionado: true }]
          }),
          inicializar: async () => ({ ok: true, autenticado: true }),
          selecionarDispositivo: async ({ id }) => ({ ok: true, id }),
          addListener: () => ({ remove: async () => {} }),
          pagar: async (dados) => {
            globalThis._plugPagCalls.push(dados);
            return { aprovado: true, bandeira: 'VISA', nsu: '123', transacaoCode: 'ABC' };
          },
          abortar: async () => ({ ok: true })
        }
      }
    };
  });
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Kit freio', custo: 20, venda: 67.89, qtd: 3 });

  await irPara(page, 'Caixa');
  await botaoDaAba(page, 'caixa', /Nova venda/i).click();
  await page.fill('#venda-add-qtd', '1');
  await page.locator('#modal-venda button', { hasText: 'Adicionar' }).click();
  await page.locator('#btn-venda-cartao').click();

  await expect(page.locator('#modal-plugpag')).toHaveClass(/active/);
  await expect(page.locator('#pp-dispositivo')).toHaveValue('AA:BB:CC:DD:EE:FF');
  await page.getByRole('button', { name: 'Crédito parcelado' }).click();
  await page.selectOption('#pp-parcelas-qtd', '3');
  await page.selectOption('#pp-parcelas-tipo', 'credito_parc_vendedor');
  await page.getByRole('button', { name: 'Continuar cobrança' }).click();

  await expect.poll(() => page.evaluate(() => globalThis._plugPagCalls[0])).toEqual({
    valorCentavos: 6789,
    tipo: 'credito_parc_vendedor',
    parcelas: 3
  });
  await expect(page.locator('#pp-status')).toContainText('Pagamento aprovado');
  await expect.poll(async () => (await estado(page)).produtos[0].qtd).toBe(2);
});

test('venda acima do estoque é recusada pelo servidor', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Corrente', custo: 50, venda: 120, qtd: 2 });

  await irPara(page, 'Caixa');
  await botaoDaAba(page, 'caixa', /Nova venda/i).click();
  await page.fill('#venda-add-qtd', '5');
  await page.locator('#modal-venda button', { hasText: 'Adicionar' }).click();
  await page.locator('#modal-venda').getByRole('button', { name: 'Dinheiro' }).click();

  await expect(page.locator('#toast')).toContainText('Estoque insuficiente');

  const { produtos } = await estado(page);
  expect(produtos[0].qtd).toBe(2);
});

test('venda por Pix gera QR e copia-e-cola no valor, e ao confirmar baixa estoque', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Pastilha', custo: 10, venda: 25, qtd: 5 });

  // Chefe cadastra a chave Pix.
  await abrirConfig(page);
  await expect(page.locator('#cfg-pix-wrap')).toBeVisible();
  await page.fill('#cfg-pix-chave', 'oficina@pix.com');
  await page.fill('#cfg-pix-nome', 'Moto Gear');
  await page.fill('#cfg-pix-cidade', 'Sao Paulo');
  await page.locator('#cfg-pix-wrap').getByRole('button', { name: /Salvar chave Pix/ }).click();
  await expect(page.locator('#toast')).toContainText('Pix salva');
  await page.locator('#modal-config').getByRole('button', { name: 'Fechar configurações' }).click();

  // Venda de 2x25 = 50 cobrada no Pix.
  await irPara(page, 'Caixa');
  await botaoDaAba(page, 'caixa', /Nova venda/i).click();
  await page.fill('#venda-add-qtd', '2');
  await page.locator('#modal-venda button', { hasText: 'Adicionar' }).click();
  await expect(page.locator('#lista-itens-venda')).toContainText('Pastilha');

  const btnPix = page.locator('#btn-venda-pix');
  await expect(btnPix).toBeVisible(); // aparece porque há chave configurada
  await btnPix.click();

  // Modal do Pix: QR desenhado e copia-e-cola bem-formado no valor certo.
  await expect(page.locator('#modal-pix')).toHaveClass(/active/);
  await expect(page.locator('#pix-qr svg')).toBeVisible();
  await expect(page.locator('#pix-valor')).toContainText('50,00');
  const copia = await page.locator('#pix-copia').inputValue();
  expect(copia.startsWith('000201')).toBeTruthy();
  expect(copia).toContain('br.gov.bcb.pix');
  expect(copia).toContain('oficina@pix.com');
  expect(copia).toContain('5303986'); // moeda BRL
  expect(copia).toMatch(/6304[0-9A-F]{4}$/); // termina com o CRC de 4 dígitos

  // Confirmar recebimento fecha os dois modais e registra a venda.
  await page.locator('#modal-pix').getByRole('button', { name: /Confirmar recebimento/ }).click();
  await expect(page.locator('#modal-pix')).not.toHaveClass(/active/);
  await expect(page.locator('#modal-venda')).not.toHaveClass(/active/);
  await expect(page.locator('#toast')).toContainText('Venda no Pix');

  const { produtos } = await estado(page);
  expect(produtos.find((p) => p.nome === 'Pastilha').qtd).toBe(3);
});

test('ações da venda, incluindo PIX, cabem sem rolagem horizontal em qualquer largura', async ({ page, baseURL, request }) => {
  await request.post(`${baseURL}/api/auth/organizacao/pix`, {
    data: { chave: 'oficina@pix.com', nome: 'Moto Gear', cidade: 'Sao Paulo' },
    headers: { Authorization: `Bearer ${token}` }
  });

  await page.setViewportSize({ width: 320, height: 700 });
  await abrirLogado(page, baseURL, token);
  await irPara(page, 'Caixa');

  for (const width of [320, 360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    if (await page.locator('#modal-venda').evaluate((node) => node.classList.contains('active'))) {
      await page.locator('#modal-venda').getByRole('button', { name: 'Fechar venda' }).click();
    }

    await botaoDaAba(page, 'caixa', /Nova venda/i).click();
    await expect(page.locator('#btn-venda-pix')).toBeVisible();

    const layout = await page.locator('#modal-venda').evaluate((modal) => {
      const pix = modal.querySelector('#btn-venda-pix').getBoundingClientRect();
      const content = modal.querySelector('.modal-content');
      return {
        viewport: window.innerWidth,
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        modalOverflow: content.scrollWidth - content.clientWidth,
        pixLeft: pix.left,
        pixRight: pix.right
      };
    });

    expect(layout.documentOverflow, `documento em ${width}px`).toBeLessThanOrEqual(0);
    expect(layout.modalOverflow, `modal em ${width}px`).toBeLessThanOrEqual(0);
    expect(layout.pixLeft, `PIX começa fora em ${width}px`).toBeGreaterThanOrEqual(0);
    expect(layout.pixRight, `PIX termina fora em ${width}px`).toBeLessThanOrEqual(layout.viewport);
  }
});

test('sem chave Pix cadastrada, o botão Pix não aparece na venda', async ({ page, baseURL, request }) => {
  // A chave Pix mora na organização e sobrevive ao reset de dados, então zera
  // aqui pra não herdar a chave de um teste anterior.
  await request.post(`${baseURL}/api/auth/organizacao/pix`, {
    data: { chave: '', nome: '', cidade: '' },
    headers: { Authorization: `Bearer ${token}` }
  });

  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Vela', custo: 5, venda: 15, qtd: 4 });

  await irPara(page, 'Caixa');
  await botaoDaAba(page, 'caixa', /Nova venda/i).click();
  await page.fill('#venda-add-qtd', '1');
  await page.locator('#modal-venda button', { hasText: 'Adicionar' }).click();

  await expect(page.locator('#btn-venda-pix')).toBeHidden();
});

test('despesa manual entra como saída', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await irPara(page, 'Caixa');
  await botaoDaAba(page, 'caixa', /Nova despesa/i).click();
  await page.fill('#despesa-desc', 'Aluguel');
  await page.fill('#despesa-valor', '1500');
  await page.locator('#modal-despesa').getByRole('button', { name: 'Lançar' }).click();

  await expect(page.locator('#caixa-saldo')).toHaveText('-R$ 1.500,00');
  await expect(page.locator('#lista-transacoes')).toContainText('Aluguel');
});

/* ------------------------------ clientes e OS ------------------------------ */

test('cliente aparece na busca por placa', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarCliente(page, { nome: 'João da Silva', placa: 'XYZ9K88' });

  await page.fill('#busca-cliente', 'xyz9');
  await expect(page.locator('#lista-clientes')).toContainText('João da Silva');

  await page.fill('#busca-cliente', 'nao-existe');
  await expect(page.locator('#lista-clientes')).toContainText('Nenhum cliente');
});

test('ciclo completo da OS: criar, andamento debita estoque, concluir gera pendência', async ({ page, baseURL }) => {
  const erros = await abrirLogado(page, baseURL, token);

  await cadastrarProduto(page, { nome: 'Bateria', custo: 100, venda: 250, qtd: 3 });
  await cadastrarCliente(page, { nome: 'Pedro Motoqueiro', placa: 'MOT0R01' });

  await page.locator('#lista-clientes .card').first().click();
  await expect(page.locator('#perfil-cliente')).toHaveClass(/active/);

  // Nova OS com a bateria
  await page.locator('#perfil-cliente').getByRole('button', { name: /Nova OS/ }).click();
  await page.locator('#modal-os button', { hasText: 'Adicionar' }).click();
  await expect(page.locator('#lista-itens-os')).toContainText('Bateria');
  await page.locator('#btn-salvar-os').click();
  await expect(page.locator('#modal-os')).not.toHaveClass(/active/);

  let dados = await estado(page);
  expect(dados.os).toHaveLength(1);
  expect(dados.os[0].status).toBe('Pendente');
  expect(dados.produtos[0].qtd).toBe(3, 'OS pendente não debita estoque');

  // Passa para "Andamento": aí sim o estoque sai
  await page.locator('#pc-conteudo .card').first().click();
  await page.selectOption('#os-status', 'Andamento');
  await page.locator('#btn-salvar-os').click();
  await expect(page.locator('#modal-os')).not.toHaveClass(/active/);

  dados = await estado(page);
  expect(dados.produtos[0].qtd).toBe(2);

  // Conclui pagando só uma parte
  await page.locator('#pc-conteudo .card').first().click();
  await page.selectOption('#os-status', 'Concluída');
  await page.fill('#os-valor-pago', '150');
  await page.fill('#os-tempo-gasto', '45');
  await page.locator('#btn-salvar-os').click();
  await expect(page.locator('#modal-os')).not.toHaveClass(/active/);

  dados = await estado(page);
  expect(dados.os[0]).toMatchObject({ status: 'Concluída', valorPago: 150, valorTotal: 250, tempoGasto: 45 });

  // A pendência de 100 aparece na aba Financeiro
  await page.locator('#perfil-cliente .sub-tab', { hasText: 'Financeiro' }).click();
  await expect(page.locator('#pc-conteudo')).toContainText('Deve R$ 100,00');

  await page.locator('#pc-conteudo').getByRole('button', { name: /Registrar pagamento/ }).click();
  await expect(page.locator('#pc-conteudo')).toContainText('Nenhuma pendência');

  dados = await estado(page);
  expect(dados.os[0].valorPago).toBe(250);
  expect(erros).toEqual([]);
});

test('cliente com pendência fica destacado na lista', async ({ page, baseURL, request }) => {
  // Monta o cenário pela API para o teste focar só na exibição.
  const cabecalho = { Authorization: `Bearer ${token}` };
  const produto = await (
    await request.post(`${baseURL}/api/produtos`, { data: { nome: 'Pneu', custo: 100, venda: 300, qtd: 5 }, headers: cabecalho })
  ).json();
  const cliente = await (
    await request.post(`${baseURL}/api/clientes`, { data: { nome: 'Devedor', placa: 'DEV1D23' }, headers: cabecalho })
  ).json();
  const os = await (
    await request.post(`${baseURL}/api/ordens`, {
      data: { tipo: 'os', clienteId: cliente.id, itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }] },
      headers: cabecalho
    })
  ).json();
  await request.put(`${baseURL}/api/ordens/${os.id}`, {
    data: { tipo: 'os', itens: [{ tipo: 'produto', itemId: produto.id, qtd: 1 }], status: 'Concluída', valorPago: 50 },
    headers: cabecalho
  });

  await abrirLogado(page, baseURL, token);
  await irPara(page, 'Clientes');
  await expect(page.locator('#lista-clientes')).toContainText('deve R$ 250,00');
});

test('orçamento aprovado vira OS pendente', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Amortecedor', custo: 90, venda: 220, qtd: 4 });
  await cadastrarCliente(page, { nome: 'Cliente Orçamento' });

  await page.locator('#lista-clientes .card').first().click();
  await page.locator('#perfil-cliente').getByRole('button', { name: 'Orçamento' }).click();
  await page.locator('#modal-os button', { hasText: 'Adicionar' }).click();
  await page.locator('#btn-salvar-os').click();
  await expect(page.locator('#modal-os')).not.toHaveClass(/active/);

  await page.locator('#perfil-cliente .sub-tab', { hasText: 'Orçamentos' }).click();
  await page.locator('#pc-conteudo .card').first().click();
  await page.locator('#modal-os').getByRole('button', { name: /Aprovar e gerar OS/ }).click();
  await expect(page.locator('#modal-os')).not.toHaveClass(/active/);

  const dados = await estado(page);
  expect(dados.orcamentos).toHaveLength(1);
  expect(dados.os).toHaveLength(1);
  expect(dados.os[0].status).toBe('Pendente');
  expect(dados.produtos[0].qtd).toBe(4, 'aprovar orçamento não mexe no estoque');
});

test('central de OS lista as ordens ativas de todos os clientes', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Lâmpada', custo: 5, venda: 15, qtd: 10 });
  await cadastrarCliente(page, { nome: 'Cliente Central' });

  await page.locator('#lista-clientes .card').first().click();
  await page.locator('#perfil-cliente').getByRole('button', { name: /Nova OS/ }).click();
  await page.locator('#modal-os button', { hasText: 'Adicionar' }).click();
  await page.locator('#btn-salvar-os').click();
  await page.locator('#perfil-cliente').getByRole('button', { name: 'Voltar' }).click();

  await botaoDaAba(page, 'clientes', /Central de OS/).click();
  await expect(page.locator('#lista-central-os')).toContainText('Cliente Central');
  await expect(page.locator('#lista-central-os')).toContainText('Pendente');
});

/* -------------------------------- análises --------------------------------- */

test('análises somam receitas, despesas e ranking de vendas', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Óleo 20W50', custo: 15, venda: 35, qtd: 10 });

  await irPara(page, 'Caixa');
  await botaoDaAba(page, 'caixa', /Nova venda/i).click();
  await page.fill('#venda-add-qtd', '2');
  await page.locator('#modal-venda button', { hasText: 'Adicionar' }).click();
  await page.locator('#modal-venda').getByRole('button', { name: 'Dinheiro' }).click();
  await expect(page.locator('#modal-venda')).not.toHaveClass(/active/);

  await irPara(page, 'Análises');
  await expect(page.locator('#conteudo-analises')).toContainText('R$ 70,00');
  await expect(page.locator('#conteudo-analises')).toContainText('R$ 150,00');

  await page.locator('#tab-analises .sub-tab', { hasText: 'Produtos' }).click();
  await expect(page.locator('#conteudo-analises')).toContainText('Mais vendidos');
  await expect(page.locator('#conteudo-analises')).toContainText('Óleo 20W50');
});

/* ------------------------------- nota fiscal -------------------------------- */

test('conferência da nota fiscal lança estoque e despesa', async ({ page, baseURL }) => {
  const erros = await abrirLogado(page, baseURL, token);
  await cadastrarProduto(page, { nome: 'Kit relação', custo: 80, venda: 180, qtd: 2 });

  // A leitura por IA é do servidor; aqui interceptamos para testar a
  // conferência e o lançamento sem depender de chave nem de rede externa.
  await page.route('**/api/nota-fiscal/ler', (rota) =>
    rota.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fornecedor: 'Distribuidora Moto Peças',
        numero: '12345',
        total: 500,
        itens: [
          { nome: 'Kit relação', qtd: 3, valorUnitario: 85 },
          { nome: 'Vela NGK', qtd: 10, valorUnitario: 12 }
        ]
      })
    })
  );

  await page.locator('header').getByRole('button', { name: 'Ler nota fiscal' }).click();
  await page.setInputFiles('#nota-upload', {
    name: 'nota.jpg',
    mimeType: 'image/jpeg',
    // JPEG mínimo válido de 1x1 pixel.
    buffer: Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
      'base64'
    )
  });

  await expect(page.locator('#modal-nota')).toHaveClass(/active/);
  await expect(page.locator('#nf-itens')).toContainText('Kit relação');
  await expect(page.locator('#nf-itens')).toContainText('Vela NGK');
  // O item já existente precisa vir pré-vinculado à peça do estoque.
  await expect(page.locator('#nf-0-produto')).not.toHaveValue('');

  await page.locator('#modal-nota').getByRole('button', { name: /Confirmar entrada/ }).click();
  await expect(page.locator('#modal-nota')).not.toHaveClass(/active/);

  const { produtos, transacoes, fornecedores } = await estado(page);
  expect(produtos.find((p) => p.nome === 'Kit relação').qtd).toBe(5);
  expect(produtos.find((p) => p.nome === 'Vela NGK').qtd).toBe(10);
  expect(transacoes.filter((t) => t.desc.startsWith('Compra de peças'))).toHaveLength(1);
  expect(fornecedores.some((f) => f.nome === 'Distribuidora Moto Peças')).toBe(true);
  expect(erros).toEqual([]);
});

/* --------------------------- fornecedores e sessão -------------------------- */

test('cadastro de fornecedor aparece na lista', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await irPara(page, 'Fornec.');
  await page.locator('#tab-fornecedores').getByRole('button', { name: 'Novo fornecedor' }).click();
  await page.fill('#forn-nome', 'Auto Peças Central');
  await page.fill('#forn-cnpj', '12.345.678/0001-90');
  await page.locator('#modal-fornecedor').getByRole('button', { name: 'Salvar' }).click();

  await expect(page.locator('#lista-fornecedores')).toContainText('Auto Peças Central');
});

test('configurações mostra a lista de usuários da oficina', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  await abrirConfig(page);

  await expect(page.locator('#cfg-usuarios-lista')).toContainText(USUARIO);
});

test('sair da conta volta para a tela de login', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  page.on('dialog', (dialogo) => dialogo.accept());

  await abrirConfig(page);
  await page.locator('#modal-config').getByRole('button', { name: /Sair da conta/ }).click();

  await expect(page.locator('#tela-login')).toHaveClass(/active/);
});

test('token inválido derruba para o login em vez de travar', async ({ page, baseURL }) => {
  await page.addInitScript(
    ([url]) => {
      localStorage.setItem('motogear_servidor', url);
      localStorage.setItem('motogear_token', 'token-invalido');
    },
    [baseURL]
  );
  await page.goto('/');
  await expect(page.locator('#tela-login')).toHaveClass(/active/);
});

/* ------------------------------ atualização ------------------------------- */

test('lógica de atualização: extrai o build da tag e escolhe o APK universal', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  const r = await page.evaluate(async () => {
    const m = await import('/js/atualizacao.js');
    return {
      tagBuild: m.buildDoTag('build-42'),
      tagVersao: m.buildDoTag('v2.0.7'),
      tagVazia: m.buildDoTag(''),
      escolhido: m.escolherApk([
        { name: 'app-arm64-v8a-release.apk', browser_download_url: 'a' },
        { name: 'app-universal-release.apk', browser_download_url: 'u' }
      ])?.browser_download_url,
      semApk: m.escolherApk([{ name: 'notas.txt' }])
    };
  });
  expect(r.tagBuild).toBe(42);
  expect(r.tagVersao).toBe(7);
  expect(r.tagVazia).toBe(0);
  expect(r.escolhido).toBe('u'); // prefere o universal
  expect(r.semApk).toBeNull();
});

test('atualização lê o build nativo e mantém compatibilidade com o APK build 19', async ({ page, baseURL }) => {
  await abrirLogado(page, baseURL, token);
  const builds = await page.evaluate(async () => {
    const m = await import('/js/atualizacao.js');
    globalThis.MOTOGEAR_BUILD = 0;
    globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    const legado = await m.obterBuildInstalado();
    globalThis.Capacitor.Plugins.MotoGearNative = { getAppInfo: async () => ({ build: 27, version: '2.0.27' }) };
    const nativo = await m.obterBuildInstalado();
    delete globalThis.Capacitor;
    return { legado, nativo };
  });
  expect(builds).toEqual({ legado: 19, nativo: 27 });
});

test('aviso de nova versão aparece com build mais novo, e "Depois" fecha', async ({ page, baseURL }) => {
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: 'build-999',
        name: 'Moto Gear 2.0.999',
        assets: [
          { name: 'app-arm64-v8a-release.apk', browser_download_url: 'https://exemplo/arm64.apk' },
          { name: 'app-universal-release.apk', browser_download_url: 'https://exemplo/universal.apk' }
        ]
      })
    })
  );

  await abrirLogado(page, baseURL, token);
  await expect(page.locator('#banner-atualizacao')).toBeHidden();

  await page.evaluate(async () => {
    globalThis.MOTOGEAR_BUILD = 1;
    await window.App.verificarAtualizacao();
  });
  await expect(page.locator('#banner-atualizacao')).toBeVisible();
  await expect(page.locator('#banner-atualizacao-versao')).toHaveText('Moto Gear 2.0.999');

  await page.locator('#banner-atualizacao').getByRole('button', { name: 'Depois' }).click();
  await expect(page.locator('#banner-atualizacao')).toBeHidden();
});

test('sem build mais novo, o aviso de atualização não aparece', async ({ page, baseURL }) => {
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: 'build-0', // igual ao instalado (dev/web = 0)
        name: 'atual',
        assets: [{ name: 'app-universal-release.apk', browser_download_url: 'x' }]
      })
    })
  );

  await abrirLogado(page, baseURL, token);
  await page.evaluate(async () => window.App.verificarAtualizacao());
  await expect(page.locator('#banner-atualizacao')).toBeHidden();
});
