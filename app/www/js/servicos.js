/** Serviços: mão de obra + peças vinculadas que saem do estoque junto. */

import { db, req, acao } from './api.js';
import { el, esc, moeda, showToast, abrirModal, fecharModal, setVal, txt, num, int } from './ui.js';
import { produtosAtivos } from './estoque.js';

export const servicosAtivos = () => db.servicos.filter((s) => s.ativo !== false);

/** Preço das peças vinculadas, pelo valor de venda. */
export function custoPecas(servico) {
  return (servico.pecas ?? []).reduce((acc, peca) => {
    const produto = db.produtos.find((p) => p.id === peca.produtoId);
    return acc + (produto ? produto.venda * peca.qtd : 0);
  }, 0);
}

export const precoTotalServico = (servico) => servico.valor + custoPecas(servico);

export function renderServicos() {
  const lista = servicosAtivos();
  el('lista-servicos').innerHTML = lista.length
    ? lista
        .map(
          (s) => `
        <div class="card" onclick="App.editarServico('${esc(s.id)}')">
          <div class="flex items-center justify-between">
            <p class="font-bold">${esc(s.nome)}</p>
            <p class="font-bold text-gear-orange">${moeda(precoTotalServico(s))}</p>
          </div>
          <p class="mt-1 text-xs text-slate-400">Mão de obra: ${moeda(s.valor)} | Peças: ${moeda(custoPecas(s))}</p>
        </div>`
        )
        .join('')
    : '<p class="p-4 text-center text-slate-500">Nenhum serviço cadastrado.</p>';
}

/* --------------------------- peças vinculadas ----------------------------- */

let pecasTemp = [];

function renderPecasVinculadas() {
  el('lista-pecas-servico').innerHTML = pecasTemp
    .map((peca, i) => {
      const produto = db.produtos.find((p) => p.id === peca.produtoId);
      return `
        <div class="flex items-center justify-between rounded-lg border border-gear-700 bg-gear-900 p-2 text-sm">
          <span>${peca.qtd}x ${esc(produto?.nome ?? 'Peça removida')}</span>
          <button onclick="App.remPecaServico(${i})" class="text-red-500"><i class="fas fa-trash"></i></button>
        </div>`;
    })
    .join('');
}

function preencherSelectPecas() {
  el('serv-add-peca').innerHTML = produtosAtivos()
    .map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (${moeda(p.venda)})</option>`)
    .join('');
}

export function addPecaServico() {
  const produtoId = el('serv-add-peca').value;
  if (!produtoId) return showToast('Cadastre uma peça no estoque primeiro.');
  pecasTemp.push({ produtoId, qtd: Math.max(1, int('serv-add-qtd')) });
  renderPecasVinculadas();
}

export function remPecaServico(indice) {
  pecasTemp.splice(indice, 1);
  renderPecasVinculadas();
}

/* --------------------------------- CRUD ----------------------------------- */

export function abrirModalServico() {
  el('modal-servico-titulo').textContent = 'Novo Serviço';
  setVal('serv-id', '');
  setVal('serv-nome', '');
  setVal('serv-valor', '');
  setVal('serv-add-qtd', 1);
  pecasTemp = [];
  renderPecasVinculadas();
  preencherSelectPecas();
  el('btn-del-serv').classList.add('hidden');
  abrirModal('modal-servico');
}

export function editarServico(id) {
  const servico = db.servicos.find((s) => s.id === id);
  if (!servico) return showToast('Serviço não encontrado.');
  el('modal-servico-titulo').textContent = 'Editar Serviço';
  setVal('serv-id', servico.id);
  setVal('serv-nome', servico.nome);
  setVal('serv-valor', servico.valor);
  setVal('serv-add-qtd', 1);
  pecasTemp = structuredClone(servico.pecas ?? []);
  renderPecasVinculadas();
  preencherSelectPecas();
  el('btn-del-serv').classList.remove('hidden');
  abrirModal('modal-servico');
}

export async function salvarServico() {
  const id = txt('serv-id');
  const nome = txt('serv-nome');
  if (!nome) return showToast('Nome obrigatório.');

  const dados = { nome, valor: num('serv-valor'), pecas: pecasTemp };
  const { ok } = await acao(id ? req('PUT', `/servicos/${id}`, dados) : req('POST', '/servicos', dados), 'Salvo!');
  if (ok) fecharModal('modal-servico');
}

export async function excluirServico() {
  const id = txt('serv-id');
  const servico = db.servicos.find((s) => s.id === id);
  if (!servico) return showToast('Serviço não encontrado.');
  if (!confirm(`Excluir o serviço "${servico.nome}"?`)) return;

  const { ok } = await acao(req('DELETE', `/servicos/${id}`), 'Excluído!');
  if (ok) fecharModal('modal-servico');
}
