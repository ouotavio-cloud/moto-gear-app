/** Caixa: extrato, venda de balcão, despesas e exportação. */

import { db, req, acao } from './api.js';
import { el, esc, moeda, showToast, abrirModal, fecharModal, setVal, int } from './ui.js';
import { baixarOuCompartilhar } from './files.js';

export const saldo = () => db.transacoes.reduce((acc, t) => (t.tipo === 'entrada' ? acc + t.valor : acc - t.valor), 0);

export function htmlTransacoes(lista) {
  if (!lista.length) return '<p class="p-4 text-center text-slate-500">Nenhuma transação.</p>';
  return lista
    .map((t) => {
      const cor = t.tipo === 'entrada' ? 'text-green-500' : 'text-red-500';
      const sinal = t.tipo === 'entrada' ? '+' : '-';
      return `
        <div class="flex flex-col items-start border-b border-gear-700 px-3 py-2">
          <div class="flex w-full justify-between">
            <p class="font-bold">${esc(t.desc)}</p>
            <p class="font-bold ${cor}">${sinal} ${moeda(t.valor)}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400"><i class="fas fa-user mr-1"></i>${esc(t.clienteNome)}</p>
          ${t.origemDetalhada ? `<p class="mt-1 text-xs leading-tight text-slate-500"><i class="fas fa-info-circle mr-1"></i>${esc(t.origemDetalhada)}</p>` : ''}
          <p class="mt-1 text-[10px] text-slate-600">${new Date(t.data).toLocaleString('pt-BR')}</p>
        </div>`;
    })
    .join('');
}

export function renderCaixa() {
  el('caixa-saldo').textContent = moeda(saldo());
  el('lista-transacoes').innerHTML = htmlTransacoes(db.transacoes.slice().reverse());
}

/* ------------------------------ venda balcão ------------------------------ */

export function mudarTipoVenda() {
  const tipo = el('venda-tipo').value;
  const opcoes =
    tipo === 'produto'
      ? db.produtos.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (Estoque: ${p.qtd})</option>`)
      : db.servicos.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`);
  el('venda-item').innerHTML = opcoes.join('');
}

export function abrirModalVenda() {
  setVal('venda-qtd', 1);
  mudarTipoVenda();
  abrirModal('modal-venda');
}

export async function salvarVenda() {
  const tipo = el('venda-tipo').value;
  const itemId = el('venda-item').value;
  const qtd = Math.max(1, int('venda-qtd'));
  if (!itemId) return showToast('Selecione um item.');

  const { ok, resultado } = await acao(req('POST', '/vendas', { tipo, itemId, qtd }));
  if (ok) {
    fecharModal('modal-venda');
    showToast(`Venda registrada — ${moeda(resultado.total)}`);
  }
}

/* -------------------------------- despesa --------------------------------- */

export function abrirModalDespesa() {
  setVal('despesa-desc', '');
  setVal('despesa-valor', '');
  abrirModal('modal-despesa');
}

export async function salvarDespesa() {
  const desc = el('despesa-desc').value.trim();
  const valor = parseFloat(el('despesa-valor').value) || 0;
  if (!desc) return showToast('Descrição obrigatória.');
  if (valor <= 0) return showToast('Informe um valor maior que zero.');

  const { ok } = await acao(req('POST', '/despesas', { desc, valor }), 'Despesa registrada!');
  if (ok) fecharModal('modal-despesa');
}

/* ------------------------------- exportação -------------------------------- */

export function exportarCaixaCSV() {
  if (!db.transacoes.length) return showToast('Nenhuma transação para exportar.');
  const aspas = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const linhas = db.transacoes.map((t) =>
    [
      aspas(new Date(t.data).toLocaleString('pt-BR')),
      aspas(t.desc),
      aspas(t.clienteNome),
      t.tipo,
      t.valor.toFixed(2),
      aspas(t.origemDetalhada)
    ].join(',')
  );
  const csv = ['Data,Descrição,Cliente,Tipo,Valor,Origem Detalhada', ...linhas].join('\n');
  // BOM para o Excel abrir os acentos corretamente.
  baixarOuCompartilhar(
    `motogear_caixa_${new Date().toISOString().slice(0, 10)}.csv`,
    '﻿' + csv,
    'text/csv;charset=utf-8;'
  );
}

export async function limparCaixa() {
  if (!confirm('Apagar TODO o histórico do caixa? Peças e clientes continuam intactos.')) return;
  await acao(req('DELETE', '/transacoes'), 'Caixa resetado!');
}
