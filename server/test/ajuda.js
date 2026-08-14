/** Sobe o servidor com banco em memória e devolve um cliente HTTP autenticado. */

import { conectar, desconectar } from '../src/db.js';
import { cadastrarChefe } from '../src/auth.js';
import { criarApp } from '../src/app.js';

export const USUARIO = 'teste';
export const SENHA = 'segredo123';
export const OFICINA = 'Oficina Teste';

export async function subirServidor() {
  process.env.NODE_ENV = 'test';
  delete process.env.DATABASE_URL;

  await conectar();
  await cadastrarChefe(USUARIO, SENHA, OFICINA);

  const servidor = criarApp().listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIO, senha: SENHA })
  });
  const { token } = await login.json();

  /** Chamada autenticada à API (o prefixo /api é implícito). */
  async function api(metodo, caminho, corpo, opcoes = {}) {
    const resposta = await fetch(`${base}/api${caminho}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(opcoes.semToken ? {} : { Authorization: `Bearer ${token}` })
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const texto = await resposta.text();
    return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
  }

  async function fechar() {
    await new Promise((resolve) => servidor.close(resolve));
    await desconectar();
  }

  return { base, token, api, fechar };
}

export const estado = (api) => api('GET', '/estado').then((r) => r.corpo);

export async function criarProduto(api, dados) {
  const { corpo } = await api('POST', '/produtos', { nome: 'Peça', custo: 10, venda: 25, qtd: 5, min: 2, ...dados });
  return corpo;
}

export async function criarCliente(api, dados) {
  const { corpo } = await api('POST', '/clientes', { nome: 'Cliente', placa: 'ABC1D23', moto: 'CG 160', ...dados });
  return corpo;
}
