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
        <div class="card inventory-card ${alerta ? 'border-l-4 border-l-red-500' : ''}">
          <button class="min-w-0 text-left" onclick="App.editarProduto('${esc(p.id)}')" aria-label="Editar ${esc(p.nome)}">
            <p class="font-bold">${esc(p.nome)} ${p.marca ? `<span class="text-xs text-slate-400">(${esc(p.marca)})</span>` : ''}</p>
            <p class="mt-1 text-sm text-gear-orange">Venda: ${moeda(p.venda)} <span class="text-slate-500">· Custo: ${moeda(p.custo)}</span></p>
            ${p.codigoBarras ? `<p class="mt-1 break-all text-[11px] text-slate-500"><i data-lucide="scan-barcode" class="mr-1" aria-hidden="true"></i>${esc(p.codigoBarras)}</p>` : ''}
          </button>
          <div class="stock-controls">
            <button onclick="App.removeEstoqueRapido('${esc(p.id)}')" class="btn-icon !h-11 !w-11 !border-red-500/30 !text-red-400" aria-label="Remover uma unidade de ${esc(p.nome)}"><i data-lucide="minus" aria-hidden="true"></i></button>
            <div class="stock-value">
              <p class="text-2xl font-bold ${alerta ? 'text-red-500' : ''}">${p.qtd}</p>
              <p class="text-[10px] uppercase tracking-wide text-slate-400">Estoque</p>
            </div>
            <button onclick="App.addEstoqueRapido('${esc(p.id)}')" class="btn-icon !h-11 !w-11 !border-green-500/30 !text-green-400" aria-label="Adicionar uma unidade de ${esc(p.nome)}"><i data-lucide="plus" aria-hidden="true"></i></button>
          </div>
        </div>`;
        })
        .join('')
    : '<p class="empty-state">Nenhuma peça cadastrada.</p>';
}

export function renderAlertas() {
  const baixos = produtosAtivos().filter((p) => p.qtd <= p.min);
  el('dash-alertas').innerHTML = baixos.length
    ? baixos
        .map(
          (p) =>
            `<div class="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-100"><span class="font-semibold">${esc(p.nome)}</span><span class="shrink-0">Restam: ${p.qtd}</span></div>`
        )
        .join('')
    : '<p class="empty-state">Nenhum alerta de estoque baixo.</p>';
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
