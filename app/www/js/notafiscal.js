/**
 * Entrada de mercadoria por foto da nota fiscal.
 *
 * Fluxo: foto -> servidor lê com IA e devolve os itens -> tela de conferência
 * onde tudo é editável -> só então o estoque sobe e a despesa entra no caixa.
 *
 * A IA erra: preço trocado, item faltando, quantidade errada. Por isso nada é
 * gravado sem passar pela conferência — a leitura é um rascunho, não a verdade.
 */

import { db, req, acao } from './api.js';
import { el, esc, moeda, showToast, abrirModal, fecharModal, carregando, pararCarregando, num } from './ui.js';
import { comprimirImagem } from './files.js';
import { acharPorNome } from './fornecedores.js';
import { margemPadrao } from './config.js';

let notaTemp = null;

export function abrirLeitorNota() {
  el('nota-upload').click();
}

export async function processarFotoNota(evento) {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!arquivo) return;

  carregando('Lendo a nota fiscal...');
  try {
    const imagem = await comprimirImagem(arquivo);
    notaTemp = await req('POST', '/nota-fiscal/ler', { imagemBase64: imagem.base64, mimeType: imagem.mimeType });

    if (!notaTemp.itens?.length) {
      showToast('Nenhum item foi identificado nesta foto.');
      return;
    }
    renderRevisaoNota();
    abrirModal('modal-nota');
  } catch (err) {
    console.error('Leitura de nota falhou', err);
    showToast(err.message || 'Não consegui ler esta nota.');
  } finally {
    pararCarregando();
  }
}

/** Casa o item da nota com uma peça já cadastrada, pelo nome. */
function sugerirProduto(nomeItem) {
  const alvo = nomeItem.toLowerCase();
  return (
    db.produtos.find((p) => p.nome.toLowerCase() === alvo) ??
    db.produtos.find((p) => p.nome.toLowerCase().includes(alvo) || alvo.includes(p.nome.toLowerCase())) ??
    null
  );
}

function renderRevisaoNota() {
  const somaItens = notaTemp.itens.reduce((acc, i) => acc + i.qtd * i.valorUnitario, 0);
  const fornecedorExistente = acharPorNome(notaTemp.fornecedor);

  el('nf-fornecedor').value = notaTemp.fornecedor ?? '';
  el('nf-total').value = (Number(notaTemp.total) || somaItens).toFixed(2);
  el('nf-resumo').innerHTML = `
    ${notaTemp.numero ? `Nota ${esc(notaTemp.numero)} · ` : ''}
    ${notaTemp.data ? `${esc(notaTemp.data)} · ` : ''}
    ${notaTemp.itens.length} item(ns) · soma dos itens ${moeda(somaItens)}`;

  el('nf-cadastrar-forn-linha').classList.toggle('hidden', Boolean(fornecedorExistente) || !notaTemp.fornecedor);
  el('nf-cadastrar-forn').checked = !fornecedorExistente && Boolean(notaTemp.fornecedor);

  const opcoesProduto = db.produtos.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (tem ${p.qtd})</option>`).join('');

  el('nf-itens').innerHTML = notaTemp.itens
    .map(
      (item, i) => `
      <div class="card !mb-2 p-3">
        <label class="flex items-center gap-2 !normal-case">
          <input type="checkbox" id="nf-${i}-usar" class="!m-0 !w-auto" checked>
          <span class="text-sm font-bold text-white">${esc(item.nome)}</span>
        </label>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div><label>Qtd</label><input type="number" id="nf-${i}-qtd" value="${item.qtd}" min="1" class="!mb-0"></div>
          <div><label>Custo unit. (R$)</label><input type="number" step="0.01" id="nf-${i}-custo" value="${Number(item.valorUnitario).toFixed(2)}" class="!mb-0"></div>
        </div>
        <label class="mt-2">Lançar em</label>
        <select id="nf-${i}-produto" class="!mb-0">
          <option value="">➕ Cadastrar como peça nova</option>
          ${opcoesProduto}
        </select>
      </div>`
    )
    .join('');

  // Pré-seleciona a peça sugerida depois que os selects existem no DOM.
  notaTemp.itens.forEach((item, i) => {
    const sugestao = sugerirProduto(item.nome);
    if (sugestao) el(`nf-${i}-produto`).value = sugestao.id;
  });
}

export async function confirmarNota() {
  if (!notaTemp) return;

  const itens = notaTemp.itens
    .map((item, i) => ({
      nome: item.nome,
      qtd: Math.max(1, num(`nf-${i}-qtd`)),
      custo: num(`nf-${i}-custo`),
      produtoId: el(`nf-${i}-produto`).value || null,
      usar: el(`nf-${i}-usar`).checked
    }))
    .filter((i) => i.usar);

  if (!itens.length) return showToast('Nenhum item selecionado.');

  const corpo = {
    fornecedor: el('nf-fornecedor').value.trim(),
    cnpj: notaTemp.cnpj ?? '',
    numero: notaTemp.numero ?? '',
    total: num('nf-total'),
    margem: margemPadrao(),
    cadastrarFornecedor: el('nf-cadastrar-forn').checked,
    itens
  };

  const { ok, resultado } = await acao(req('POST', '/nota-fiscal/entrada', corpo), null, 'Lançando no estoque...');
  if (ok) {
    const novos = resultado.aplicados.filter((a) => a.novo).length;
    fecharModal('modal-nota');
    notaTemp = null;
    showToast(`${resultado.aplicados.length} item(ns) no estoque${novos ? `, ${novos} novo(s)` : ''}.`);
  }
}

export function cancelarNota() {
  notaTemp = null;
  fecharModal('modal-nota');
}
