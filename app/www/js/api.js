/**
 * Cliente da API.
 *
 * O servidor é a fonte da verdade: o app não guarda dados de negócio: mantém
 * apenas um espelho em memória (`db`) do último `GET /estado`, redesenhado a
 * cada operação. No aparelho ficam só endereço do servidor e token de sessão.
 */

import { showToast, renderAll, carregando, pararCarregando } from './ui.js';

const CHAVE_SERVIDOR = 'motogear_servidor';
const CHAVE_TOKEN = 'motogear_token';

/** Espelho do estado no servidor. Os módulos de tela leem daqui. */
export const db = {
  produtos: [],
  servicos: [],
  clientes: [],
  os: [],
  orcamentos: [],
  transacoes: [],
  fornecedores: []
};

let aoPerderSessao = () => {};
export const quandoDeslogar = (fn) => {
  aoPerderSessao = fn;
};

/* ------------------------------ configuração ------------------------------ */

function guardar(chave, valor) {
  try {
    if (valor) localStorage.setItem(chave, valor);
    else localStorage.removeItem(chave);
  } catch (err) {
    console.error('Não consegui gravar a preferência', err);
  }
}

function lido(chave) {
  try {
    return localStorage.getItem(chave) ?? '';
  } catch {
    return '';
  }
}

/** Endereço do servidor: o salvo, o embutido no build ou a própria origem. */
export function servidor() {
  const salvo = lido(CHAVE_SERVIDOR);
  if (salvo) return salvo.replace(/\/+$/, '');
  const embutido = globalThis.MOTOGEAR_SERVIDOR ?? '';
  if (embutido) return embutido.replace(/\/+$/, '');
  // Servido pelo próprio backend (navegador): mesma origem.
  return location.origin.startsWith('http') ? location.origin : '';
}

export const setServidor = (url) => guardar(CHAVE_SERVIDOR, String(url ?? '').trim().replace(/\/+$/, ''));
export const token = () => lido(CHAVE_TOKEN);
export const temSessao = () => Boolean(token());

/* -------------------------------- chamadas -------------------------------- */

export async function req(metodo, caminho, corpo) {
  const base = servidor();
  if (!base) throw new Error('Informe o endereço do servidor.');

  const enviouToken = Boolean(token());

  let resposta;
  try {
    resposta = await fetch(`${base}/api${caminho}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(enviouToken ? { Authorization: `Bearer ${token()}` } : {})
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
  } catch (err) {
    console.error('Falha de rede', err);
    throw new Error('Sem conexão com o servidor. Verifique a internet.');
  }

  // 401 numa chamada que levava token significa sessão perdida. Sem token (o
  // próprio login), é credencial errada e quem explica é a mensagem do servidor.
  if (resposta.status === 401 && enviouToken) {
    guardar(CHAVE_TOKEN, '');
    aoPerderSessao();
    throw new Error('Sessão encerrada. Entre novamente.');
  }

  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!resposta.ok) throw new Error(dados?.erro ?? `Falha na operação (HTTP ${resposta.status}).`);
  return dados;
}

/* --------------------------------- sessão --------------------------------- */

export async function entrar({ url, usuario, senha }) {
  if (url) setServidor(url);
  guardar(CHAVE_TOKEN, '');
  const { token: novo } = await req('POST', '/auth/login', { usuario, senha });
  guardar(CHAVE_TOKEN, novo);
  return novo;
}

export async function cadastrar({ url, usuario, senha }) {
  if (url) setServidor(url);
  guardar(CHAVE_TOKEN, '');
  const { token: novo } = await req('POST', '/auth/cadastro', { usuario, senha });
  guardar(CHAVE_TOKEN, novo);
  return novo;
}

export function sair() {
  guardar(CHAVE_TOKEN, '');
  aoPerderSessao();
}

/* --------------------------------- estado --------------------------------- */

export async function carregarEstado() {
  const estado = await req('GET', '/estado');
  for (const chave of Object.keys(db)) db[chave] = estado[chave] ?? [];
  return db;
}

/**
 * Executa uma operação de escrita, recarrega o estado e redesenha a tela.
 * Centralizar isso evita que cada tela esqueça de atualizar algum contador.
 */
export async function acao(promessa, mensagemSucesso, textoCarregando) {
  if (textoCarregando) carregando(textoCarregando);
  try {
    const resultado = await promessa;
    await carregarEstado();
    renderAll();
    if (mensagemSucesso) showToast(mensagemSucesso);
    return { ok: true, resultado };
  } catch (err) {
    showToast(err.message);
    return { ok: false, erro: err };
  } finally {
    if (textoCarregando) pararCarregando();
  }
}
