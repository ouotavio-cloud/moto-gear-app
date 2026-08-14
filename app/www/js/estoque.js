/** Estoque: cadastro de peças, ajustes rápidos e alertas de mínimo. */

import { db, req, acao } from './api.js';
import { el, esc, moeda, showToast, abrirModal, fecharModal, setVal, txt, num, int } from './ui.js';

export const produtosAtivos = () => db.produtos.filter((p) => p.ativo !== false);

export function buscarPorCodigo(codigo) {
  const alvo = String(codigo ?? '').trim();
  if (!alvo) return null;
  return produtosAtivos().find((p) => (p.codigoBarras ?? '') === alvo) ?? null;
}

export function renderEstoque() {
  const busca = (el('busca-estoque')?.value ?? '').toLowerCase();
  const lista = produtosAtivos().filter(
    (p) => p.nome.toLowerCase().includes(busca) || (p.codigoBarras ?? '').includes(busca)
  );

  el('lista-estoque').innerHTML = lista.length
    ? lista
        .map((p) => {
          const alerta = p.qtd <= p.min;
          return `
        <div class="card flex items-center justify-between ${alerta ? 'border-l-4 border-l-red-500' : ''}">
          <div class="flex-1" onclick="App.editarProduto('${esc(p.id)}')">
            <p class="font-bold">${esc(p.nome)} ${p.marca ? `<span class="text-xs text-slate-400">(${esc(p.marca)})</span>` : ''}</p>
            <p class="text-sm text-gear-orange">Venda: ${moeda(p.venda)} | Custo: ${moeda(p.custo)}</p>
            ${p.codigoBarras ? `<p class="text-[10px] text-slate-500"><i class="fas fa-barcode mr-1"></i>${esc(p.codigoBarras)}</p>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <button onclick="App.removeEstoqueRapido('${esc(p.id)}')" class="h-8 w-8 rounded-full bg-red-500 font-bold text-white active:scale-95">-</button>
            <div class="min-w-[60px] rounded-xl border border-gear-700 bg-gear-900 px-4 py-2 text-center">
              <p class="text-2xl font-bold ${alerta ? 'text-red-500' : ''}">${p.qtd}</p>
              <p class="text-[10px] text-slate-400">ESTOQUE</p>
            </div>
            <button onclick="App.addEstoqueRapido('${esc(p.id)}')" class="h-8 w-8 rounded-full bg-green-500 font-bold text-white active:scale-95">+</button>
          </div>
        </div>`;
        })
        .join('')
    : '<p class="p-4 text-center text-slate-500">Nenhuma peça cadastrada.</p>';
}

export function renderAlertas() {
  const baixos = produtosAtivos().filter((p) => p.qtd <= p.min);
  el('dash-alertas').innerHTML = baixos.length
    ? baixos
        .map(
          (p) =>
            `<div class="flex justify-between rounded-lg bg-red-500 p-2 text-sm text-white"><span class="font-bold">${esc(p.nome)}</span><span>Restam: ${p.qtd}</span></div>`
        )
        .join('')
    : '<p class="text-sm text-slate-500">Nenhum alerta de estoque baixo.</p>';
}

/* --------------------------------- CRUD ----------------------------------- */

function preencherForm(p) {
  setVal('prod-id', p?.id ?? '');
  setVal('prod-nome', p?.nome ?? '');
  setVal('prod-categoria', p?.categoria ?? '');
  setVal('prod-marca', p?.marca ?? '');
  setVal('prod-codigo', p?.codigoBarras ?? '');
  setVal('prod-custo', p?.custo ?? '');
  setVal('prod-venda', p?.venda ?? '');
  setVal('prod-qtd', p?.qtd ?? '');
  setVal('prod-min', p?.min ?? 2);
}

export function abrirModalProduto(prefill = {}) {
  el('modal-produto-titulo').textContent = 'Novo Produto';
  preencherForm(null);
  if (prefill.codigoBarras) setVal('prod-codigo', prefill.codigoBarras);
  if (prefill.nome) setVal('prod-nome', prefill.nome);
  el('btn-del-prod').classList.add('hidden');
  abrirModal('modal-produto');
}

export function editarProduto(id) {
  const produto = db.produtos.find((p) => p.id === id);
  if (!produto) return showToast('Produto não encontrado.');
  el('modal-produto-titulo').textContent = 'Editar Produto';
  preencherForm(produto);
  el('btn-del-prod').classList.remove('hidden');
  abrirModal('modal-produto');
}

export async function salvarProduto() {
  const id = txt('prod-id');
  const nome = txt('prod-nome');
  if (!nome) return showToast('Nome obrigatório.');

  const dados = {
    nome,
    categoria: txt('prod-categoria'),
    marca: txt('prod-marca'),
    codigoBarras: txt('prod-codigo'),
    custo: num('prod-custo'),
    venda: num('prod-venda'),
    qtd: int('prod-qtd'),
    min: int('prod-min') || 2
  };

  const { ok } = await acao(id ? req('PUT', `/produtos/${id}`, dados) : req('POST', '/produtos', dados), 'Salvo!');
  if (ok) fecharModal('modal-produto');
}

export async function excluirProduto() {
  const id = txt('prod-id');
  const produto = db.produtos.find((p) => p.id === id);
  if (!produto) return showToast('Produto não encontrado.');
  if (!confirm(`Excluir "${produto.nome}" do estoque?`)) return;

  const { ok } = await acao(req('DELETE', `/produtos/${id}`), 'Excluído!');
  if (ok) fecharModal('modal-produto');
}

/* ----------------------------- ajustes rápidos ---------------------------- */

export const addEstoqueRapido = (id) => acao(req('POST', `/produtos/${id}/ajuste`, { delta: 1 }), '+1 adicionado!');
export const removeEstoqueRapido = (id) => acao(req('POST', `/produtos/${id}/ajuste`, { delta: -1 }), '-1 removido!');

/** Soma de unidades em estoque, exibida no dashboard. */
export const totalUnidades = () => produtosAtivos().reduce((acc, p) => acc + p.qtd, 0);
