/** Caixa: extrato, venda de balcão, despesas e exportação. */

import { db, req, acao, carregarEstado } from './api.js';
import { el, esc, moeda, showToast, abrirModal, fecharModal, setVal, int } from './ui.js';
import { baixarOuCompartilhar } from './files.js';
import { cobrarNoCartao, maquininhaDisponivel } from './mercado-pago.js';
import { cobrarNoPix, pixDisponivel, carregarConfigPix } from './pix.js';
import { precoTotalServico } from './servicos.js';

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
          <p class="mt-1 text-xs text-slate-400"><i data-lucide="user" class="mr-1"></i>${esc(t.clienteNome)}</p>
          ${t.origemDetalhada ? `<p class="mt-1 text-xs leading-tight text-slate-500"><i data-lucide="info" class="mr-1"></i>${esc(t.origemDetalhada)}</p>` : ''}
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

let itensVendaTemp = [];
let cotacaoVendaAtual = '';

export function mudarTipoVenda() {
  const tipo = el('venda-add-tipo').value;
  const opcoes =
    tipo === 'produto'
      ? db.produtos.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (${moeda(p.venda)} — Estoque: ${p.qtd})</option>`)
      : db.servicos.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)} (${moeda(precoTotalServico(s))})</option>`);
  el('venda-add-item').innerHTML = opcoes.join('');
}

export function addItemVenda() {
  const tipo = el('venda-add-tipo').value;
  const itemId = el('venda-add-item').value;
  const qtd = Math.max(1, int('venda-add-qtd'));
  if (!itemId) return showToast('Nada para adicionar.');

  let nome = '';
  let total = 0;

  if (tipo === 'produto') {
    const produto = db.produtos.find((p) => p.id === itemId);
    if (!produto) return showToast('Produto não encontrado.');
    nome = produto.nome;
    total = produto.venda * qtd;
  } else {
    const servico = db.servicos.find((s) => s.id === itemId);
    if (!servico) return showToast('Serviço não encontrado.');
    nome = servico.nome;
    total = precoTotalServico(servico) * qtd;
  }

  itensVendaTemp.push({ tipo, itemId, nome, qtd, total });
  cotacaoVendaAtual = '';
  setVal('venda-add-qtd', 1);
  renderItensVenda();
}

export function remItemVenda(indice) {
  itensVendaTemp.splice(indice, 1);
  cotacaoVendaAtual = '';
  renderItensVenda();
}

function renderItensVenda() {
  const total = itensVendaTemp.reduce((acc, i) => acc + i.total, 0);
  el('lista-itens-venda').innerHTML = itensVendaTemp.length
    ? itensVendaTemp
        .map(
          (item, i) => `
        <div class="flex items-center justify-between gap-3 rounded-xl border border-gear-700 bg-gear-800 p-3 text-sm">
          <div class="min-w-0 flex-1">
            <p class="font-bold">${item.qtd}x ${esc(item.nome)}</p>
            <p class="text-xs text-slate-400">${moeda(item.total)}</p>
          </div>
          <button onclick="App.remItemVenda(${i})" class="btn-icon !h-10 !w-10 !border-red-500/30 !text-red-400" aria-label="Remover ${esc(item.nome)}"><i data-lucide="trash-2" aria-hidden="true"></i></button>
        </div>`
        )
        .join('')
    : '<p class="empty-state">Nenhum item adicionado.</p>';

  el('venda-total').textContent = moeda(total);
}

export async function abrirModalVenda() {
  itensVendaTemp = [];
  cotacaoVendaAtual = '';
  setVal('venda-add-qtd', 1);
  mudarTipoVenda();
  renderItensVenda();
  el('btn-venda-cartao')?.classList.toggle('hidden', !maquininhaDisponivel());
  el('btn-venda-pix')?.classList.toggle('hidden', !pixDisponivel());
  abrirModal('modal-venda');

  await carregarConfigPix();
  el('btn-venda-pix')?.classList.toggle('hidden', !pixDisponivel());
}

export async function prepararVendaAssistente(itens = []) {
  try {
    await carregarEstado();
  } catch (err) {
    showToast(err.message || 'Não foi possível atualizar os itens da venda. Tente novamente.');
    return false;
  }
  itensVendaTemp = [];
  cotacaoVendaAtual = '';
  for (const item of itens) {
    if (item.tipo === 'produto') {
      const produto = db.produtos.find((registro) => registro.id === item.itemId);
      if (!produto) continue;
      const qtd = Math.max(1, Number(item.qtd) || 1);
      itensVendaTemp.push({ tipo: 'produto', itemId: produto.id, nome: produto.nome, qtd, total: produto.venda * qtd });
    } else if (item.tipo === 'servico') {
      const servico = db.servicos.find((registro) => registro.id === item.itemId);
      if (!servico) continue;
      const qtd = Math.max(1, Number(item.qtd) || 1);
      itensVendaTemp.push({ tipo: 'servico', itemId: servico.id, nome: servico.nome, qtd, total: precoTotalServico(servico) * qtd });
    }
  }
  if (!itensVendaTemp.length) {
    showToast('O item da venda não está mais disponível.');
    return false;
  }

  setVal('venda-add-qtd', 1);
  mudarTipoVenda();
  renderItensVenda();
  el('btn-venda-cartao')?.classList.toggle('hidden', !maquininhaDisponivel());
  el('btn-venda-pix')?.classList.toggle('hidden', !pixDisponivel());
  abrirModal('modal-venda');
  await carregarConfigPix();
  el('btn-venda-pix')?.classList.toggle('hidden', !pixDisponivel());
  return true;
}

const itensParaEnvio = () => itensVendaTemp.map(({ tipo, itemId, qtd }) => ({ tipo, itemId, qtd }));

async function cotarVenda() {
  const { ok, resultado } = await acao(req('POST', '/vendas/cotacao', { itens: itensParaEnvio() }));
  if (!ok) return null;
  itensVendaTemp = resultado.itens;
  cotacaoVendaAtual = resultado.cotacao;
  renderItensVenda();
  return resultado;
}

async function registrarVendaCotada(cotacao = cotacaoVendaAtual) {
  return acao(req('POST', '/vendas', { cotacao }));
}

const avisoEstoque = (resultado) => resultado?.estoquePendente?.length ? ' — atenção: confira o estoque pendente' : '';

export async function salvarVenda() {
  if (!itensVendaTemp.length) return showToast('Adicione ao menos um item.');

  const cotacao = await cotarVenda();
  if (!cotacao) return;
  const { ok, resultado } = await registrarVendaCotada(cotacao.cotacao);
  if (ok) {
    fecharModal('modal-venda');
    showToast(`Venda registrada — ${moeda(resultado.total)}${avisoEstoque(resultado)}`);
  }
}

export async function venderNoCartao() {
  if (!itensVendaTemp.length) return showToast('Adicione ao menos um item.');

  const cotacao = await cotarVenda();
  if (!cotacao) return;
  const valor = cotacao.total;
  if (valor <= 0) return showToast('Valor inválido.');

  const descricao = itensVendaTemp.map((i) => `${i.qtd}x ${i.nome}`).join(', ');
  const resultado = await cobrarNoCartao(valor, descricao);
  if (resultado?.aprovado) {
    const { ok, resultado: vendaRes } = await registrarVendaCotada(cotacao.cotacao);
    if (ok) {
      fecharModal('modal-venda');
      showToast(`Venda no cartão — ${moeda(vendaRes.total)}${avisoEstoque(vendaRes)}`);
    }
  }
}

export async function venderNoPix() {
  if (!itensVendaTemp.length) return showToast('Adicione ao menos um item.');

  const cotacao = await cotarVenda();
  if (!cotacao) return;
  const valor = cotacao.total;
  if (valor <= 0) return showToast('Valor inválido.');

  const descricao = itensVendaTemp.map((i) => `${i.qtd}x ${i.nome}`).join(', ');
  const resultado = await cobrarNoPix(valor, descricao);
  if (resultado?.aprovado) {
    const { ok, resultado: vendaRes } = await registrarVendaCotada(cotacao.cotacao);
    if (ok) {
      fecharModal('modal-venda');
      showToast(`Venda no Pix — ${moeda(vendaRes.total)}${avisoEstoque(vendaRes)}`);
    }
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
