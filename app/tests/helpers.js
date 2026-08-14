import { expect } from '@playwright/test';

export const USUARIO = 'teste';
export const SENHA = 'segredo123';

const VAZIO = { produtos: [], servicos: [], clientes: [], fornecedores: [], os: [], orcamentos: [], transacoes: [] };

/** Zera os dados do servidor para o teste começar de uma oficina limpa. */
export async function limparServidor(request, baseURL) {
  const login = await request.post(`${baseURL}/api/auth/login`, { data: { usuario: USUARIO, senha: SENHA } });
  const { token } = await login.json();
  const resposta = await request.post(`${baseURL}/api/restaurar`, {
    data: VAZIO,
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(resposta.ok()).toBeTruthy();
  return token;
}

/** Abre o app já logado, sem passar pela tela de login a cada teste. */
export async function abrirLogado(page, baseURL, token) {
  const erros = coletarErros(page);
  await page.addInitScript(
    ([url, jwt]) => {
      localStorage.setItem('motogear_servidor', url);
      localStorage.setItem('motogear_token', jwt);
    },
    [baseURL, token]
  );
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-pronto', 'sim');
  await expect(page.locator('body')).toHaveAttribute('data-logado', 'sim');
  return erros;
}

export function coletarErros(page) {
  const erros = [];
  page.on('pageerror', (err) => erros.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  return erros;
}

export const irPara = (page, aba) => page.locator('.nav-item', { hasText: aba }).click();

/**
 * Botão dentro de uma aba específica. Vários rótulos ("VENDER", "NOVO CLIENTE")
 * também aparecem como título de modal, então a busca precisa ser escopada.
 */
export const botaoDaAba = (page, aba, nome) => page.locator(`#tab-${aba}`).getByRole('button', { name: nome });

export async function cadastrarProduto(page, { nome, custo = 10, venda = 25, qtd = 5, min = 2 }) {
  await irPara(page, 'Estoque');
  await page.locator('#tab-estoque .fa-plus').click();
  await page.fill('#prod-nome', nome);
  await page.fill('#prod-custo', String(custo));
  await page.fill('#prod-venda', String(venda));
  await page.fill('#prod-qtd', String(qtd));
  await page.fill('#prod-min', String(min));
  await page.locator('#modal-produto').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('#modal-produto')).not.toHaveClass(/active/);
}

export async function cadastrarCliente(page, { nome, placa = 'ABC1D23', moto = 'CG 160' }) {
  await irPara(page, 'Clientes');
  await botaoDaAba(page, 'clientes', /NOVO CLIENTE/).click();
  await page.fill('#cli-nome', nome);
  await page.fill('#cli-placa', placa);
  await page.fill('#cli-moto', moto);
  await page.locator('#modal-cliente').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('#modal-cliente')).not.toHaveClass(/active/);
}

/** Estado do servidor, como o app o enxerga. */
export function estado(page) {
  return page.evaluate(async () => {
    const resposta = await fetch(`${localStorage.getItem('motogear_servidor')}/api/estado`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('motogear_token')}` }
    });
    return resposta.json();
  });
}
