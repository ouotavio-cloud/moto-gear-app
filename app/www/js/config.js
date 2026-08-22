/** Configurações: servidor, senha e preferências locais de tela. */

import { req, servidor, setServidor, sair } from './api.js';
import { el, esc, showToast, abrirModal, fecharModal, setVal, txt, num } from './ui.js';
import { setConfigPix } from './pix.js';
import { definirRespostasPorVoz, respostasPorVozAtivas } from './assistente.js';

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
  el('cfg-respostas-voz').checked = respostasPorVozAtivas();
  abrirModal('modal-config');
  renderOrganizacao();
  renderUsuarios();
}

export function alternarRespostasVoz(ativas) {
  definirRespostasPorVoz(Boolean(ativas));
  showToast(ativas ? 'Respostas por voz ativadas.' : 'Respostas por voz desativadas.');
}

async function renderOrganizacao() {
  const nomeEl = el('cfg-oficina-nome');
  const codigoWrap = el('cfg-codigo-convite-wrap');
  const pixWrap = el('cfg-pix-wrap');
  try {
    const organizacao = await req('GET', '/auth/organizacao');
    nomeEl.textContent = organizacao.nome;
    codigoWrap.classList.toggle('hidden', !organizacao.souChefe);
    if (organizacao.souChefe) el('cfg-codigo-convite').textContent = organizacao.codigoConvite;

    // Guarda a chave Pix pra que o botão Pix da venda já saiba se está configurada.
    setConfigPix(organizacao.pix);
    // Editar a chave é só do chefe; o funcionário usa a chave, mas não a altera.
    pixWrap.classList.toggle('hidden', !organizacao.souChefe);
    if (organizacao.souChefe) {
      setVal('cfg-pix-chave', organizacao.pix?.chave ?? '');
      setVal('cfg-pix-nome', organizacao.pix?.nome ?? '');
      setVal('cfg-pix-cidade', organizacao.pix?.cidade ?? '');
    }
  } catch (err) {
    nomeEl.textContent = err.message;
  }
}

export async function salvarPix() {
  const chave = txt('cfg-pix-chave');
  const nome = txt('cfg-pix-nome');
  const cidade = txt('cfg-pix-cidade');
  if (!chave) return showToast('Informe a chave Pix.');

  try {
    const { pix } = await req('POST', '/auth/organizacao/pix', { chave, nome, cidade });
    setConfigPix(pix);
    showToast('Chave Pix salva!');
  } catch (err) {
    showToast(err.message);
  }
}

export async function gerarNovoCodigoConvite() {
  if (!confirm('Gerar um novo código de convite? O código antigo deixa de funcionar.')) return;
  try {
    const { codigoConvite } = await req('POST', '/auth/organizacao/codigo');
    el('cfg-codigo-convite').textContent = codigoConvite;
    showToast('Novo código gerado!');
  } catch (err) {
    showToast(err.message);
  }
}

async function renderUsuarios() {
  const lista = el('cfg-usuarios-lista');
  try {
    const usuarios = await req('GET', '/auth/usuarios');
    lista.innerHTML = usuarios
      .map(
        (u) => `
      <div class="flex items-center justify-between border-b border-gear-700 pb-2">
        <span>
          <span class="font-bold text-white">${esc(u.usuario)}</span>
          ${u.papel === 'chefe' ? '<span class="badge ml-2">Chefe</span>' : ''}
        </span>
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
  definirRespostasPorVoz(el('cfg-respostas-voz').checked);

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
