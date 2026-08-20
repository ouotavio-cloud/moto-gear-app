/** Fornecedores: cadastro de contatos de compra. */

import { db, req, acao } from './api.js';
import { el, esc, showToast, abrirModal, fecharModal, setVal, txt } from './ui.js';

export const fornecedoresAtivos = () => db.fornecedores.filter((f) => f.ativo !== false);

export function renderFornecedores() {
  const busca = (el('busca-fornecedor')?.value ?? '').toLowerCase();
  const lista = fornecedoresAtivos().filter(
    (f) => f.nome.toLowerCase().includes(busca) || (f.cnpj ?? '').toLowerCase().includes(busca)
  );

  el('lista-fornecedores').innerHTML = lista.length
    ? lista
        .map(
          (f) => `
        <div class="card" onclick="App.editarFornecedor('${esc(f.id)}')">
          <p class="text-lg font-bold">${esc(f.nome)}</p>
          <p class="text-sm text-slate-400">
            ${f.cnpj ? `<i data-lucide="contact"></i> ${esc(f.cnpj)}` : ''}
            ${f.tel ? `| <i data-lucide="message-circle"></i> ${esc(f.tel)}` : ''}
          </p>
          ${f.vendedor ? `<p class="mt-1 text-xs text-gear-orange">Vendedor: ${esc(f.vendedor)}</p>` : ''}
        </div>`
        )
        .join('')
    : '<p class="p-4 text-center text-slate-500">Nenhum fornecedor cadastrado.</p>';
}

export function abrirModalFornecedor() {
  el('modal-fornecedor-titulo').textContent = 'Novo Fornecedor';
  for (const campo of ['forn-id', 'forn-nome', 'forn-cnpj', 'forn-tel', 'forn-vendedor', 'forn-obs']) setVal(campo, '');
  el('btn-del-forn').classList.add('hidden');
  abrirModal('modal-fornecedor');
}

export function editarFornecedor(id) {
  const fornecedor = db.fornecedores.find((f) => f.id === id);
  if (!fornecedor) return showToast('Fornecedor não encontrado.');
  el('modal-fornecedor-titulo').textContent = 'Editar Fornecedor';
  setVal('forn-id', fornecedor.id);
  setVal('forn-nome', fornecedor.nome);
  setVal('forn-cnpj', fornecedor.cnpj);
  setVal('forn-tel', fornecedor.tel);
  setVal('forn-vendedor', fornecedor.vendedor);
  setVal('forn-obs', fornecedor.obs);
  el('btn-del-forn').classList.remove('hidden');
  abrirModal('modal-fornecedor');
}

export async function salvarFornecedor() {
  const id = txt('forn-id');
  const nome = txt('forn-nome');
  if (!nome) return showToast('Nome obrigatório.');

  const dados = {
    nome,
    cnpj: txt('forn-cnpj'),
    tel: txt('forn-tel'),
    vendedor: txt('forn-vendedor'),
    obs: txt('forn-obs')
  };

  const { ok } = await acao(id ? req('PUT', `/fornecedores/${id}`, dados) : req('POST', '/fornecedores', dados), 'Salvo!');
  if (ok) fecharModal('modal-fornecedor');
}

export async function excluirFornecedor() {
  const id = txt('forn-id');
  const fornecedor = db.fornecedores.find((f) => f.id === id);
  if (!fornecedor) return showToast('Fornecedor não encontrado.');
  if (!confirm(`Excluir o fornecedor "${fornecedor.nome}"?`)) return;

  const { ok } = await acao(req('DELETE', `/fornecedores/${id}`), 'Excluído!');
  if (ok) fecharModal('modal-fornecedor');
}

/** Acha um fornecedor por nome — usado na conferência da nota fiscal. */
export function acharPorNome(nome) {
  const alvo = String(nome ?? '').trim().toLowerCase();
  if (!alvo) return null;
  return fornecedoresAtivos().find((f) => f.nome.toLowerCase() === alvo) ?? null;
}
