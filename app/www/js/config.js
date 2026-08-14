/** Configurações: servidor, senha e preferências locais de tela. */

import { req, servidor, setServidor, sair } from './api.js';
import { el, esc, showToast, abrirModal, fecharModal, setVal, txt, num } from './ui.js';

const CHAVE_MARGEM = 'motogear_margem';

/** Margem sugerida ao cadastrar peça nova pela nota fiscal. É preferência de tela. */
export function margemPadrao() {
  try {
    return Number(localStorage.getItem(CHAVE_MARGEM)) || 60;
  } catch {
    return 60;
  }
}

export function abrirConfig() {
  setVal('cfg-servidor', servidor());
  setVal('cfg-margem', margemPadrao());
  setVal('cfg-senha-atual', '');
  setVal('cfg-senha-nova', '');
  abrirModal('modal-config');
  renderUsuarios();
}

async function renderUsuarios() {
  const lista = el('cfg-usuarios-lista');
  try {
    const usuarios = await req('GET', '/auth/usuarios');
    lista.innerHTML = usuarios
      .map(
        (u) => `
      <div class="flex items-center justify-between border-b border-gear-700 pb-2">
        <span class="font-bold text-white">${esc(u.usuario)}</span>
        <span class="text-slate-400">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</span>
      </div>`
      )
      .join('');
  } catch (err) {
    lista.textContent = err.message;
  }
}

export function salvarPreferencias() {
  const margem = Math.max(0, num('cfg-margem'));
  try {
    localStorage.setItem(CHAVE_MARGEM, String(margem));
  } catch (err) {
    console.error('Não consegui salvar a margem', err);
  }

  const url = txt('cfg-servidor');
  if (url && url !== servidor()) {
    setServidor(url);
    showToast('Servidor alterado. Entre novamente.');
    sair();
    return;
  }

  showToast('Preferências salvas!');
}

export async function trocarSenha() {
  const senhaAtual = txt('cfg-senha-atual');
  const senhaNova = txt('cfg-senha-nova');
  if (!senhaAtual || !senhaNova) return showToast('Preencha a senha atual e a nova.');

  try {
    await req('POST', '/auth/senha', { senhaAtual, senhaNova });
    setVal('cfg-senha-atual', '');
    setVal('cfg-senha-nova', '');
    showToast('Senha alterada!');
  } catch (err) {
    showToast(err.message);
  }
}

export function sairDaConta() {
  if (!confirm('Sair da conta neste aparelho?')) return;
  fecharModal('modal-config');
  sair();
}

export function mostrarServidorNoRodape() {
  const node = el('cfg-servidor-atual');
  if (node) node.textContent = servidor() || 'não configurado';
}
