/**
 * Ordens de serviço e orçamentos (tela).
 *
 * As regras — quando o estoque é debitado, o que vira pendência, o que pode ou
 * não ser alterado — são aplicadas pelo servidor. Aqui é só montagem de tela e
 * envio; se o servidor recusar, a mensagem dele aparece no toast.
 */

import { db, req, acao } from './api.js';
import { el, esc, moeda, showToast, abrirModal, fecharModal, setVal, txt, num, int } from './ui.js';
import { precoTotalServico } from './servicos.js';
import { clienteAtual, nomeCliente } from './estado.js';
import { cobrarNoCartao, maquininhaDisponivel } from './plugpag.js';

let itensTemp = [];

export const osAtivas = () => db.os.filter((o) => o.status === 'Pendente' || o.status === 'Andamento');

const curto = (id) => String(id).slice(-4);

const CORES_STATUS = {
  Pendente: 'badge !bg-yellow-600',
  Andamento: 'badge !bg-blue-600',
  Concluída: 'badge !bg-green-600',
  Cancelada: 'badge !bg-red-600'
};

/* -------------------------------- itens ----------------------------------- */

export function mudarTipoItemOS() {
  const tipo = el('os-add-tipo').value;
  const opcoes =
    tipo === 'produto'
      ? db.produtos.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (${moeda(p.venda)})</option>`)
      : db.servicos.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)} (${moeda(precoTotalServico(s))})</option>`);
  el('os-add-item').innerHTML = opcoes.join('');
}

export function addItemOS() {
  const tipo = el('os-add-tipo').value;
  const itemId = el('os-add-item').value;
  const qtd = Math.max(1, int('os-add-qtd'));
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

  itensTemp.push({ tipo, itemId, nome, qtd, total });
  setVal('os-add-qtd', 1);
  renderItensOS();
}

export function remItemOS(indice) {
  itensTemp.splice(indice, 1);
  renderItensOS();
}

function renderItensOS() {
  const total = itensTemp.reduce((acc, i) => acc + i.total, 0);
  el('lista-itens-os').innerHTML = itensTemp.length
    ? itensTemp
        .map(
          (item, i) => `
        <div class="flex items-center justify-between gap-3 rounded-xl border border-gear-700 bg-gear-800 p-3 text-sm">
          <div class="min-w-0 flex-1">
            <p class="font-bold">${item.qtd}x ${esc(item.nome)}</p>
            <p class="text-xs text-slate-400">${moeda(item.total)}</p>
          </div>
          <button onclick="App.remItemOS(${i})" class="btn-icon !h-10 !w-10 !border-red-500/30 !text-red-400" aria-label="Remover ${esc(item.nome)}"><i data-lucide="trash-2" aria-hidden="true"></i></button>
        </div>`
        )
        .join('')
    : '<p class="empty-state">Nenhum item adicionado.</p>';

  setVal('os-total', total.toFixed(2));
  el('os-total').dataset.total = total.toFixed(2);
}

/* -------------------------------- modal ----------------------------------- */

export function initModalOS(tipo) {
  const clienteId = clienteAtual();
  if (!clienteId) return showToast('Abra um cliente primeiro.');

  setVal('os-id', '');
  setVal('os-cli-id', clienteId);
  setVal('os-tipo', tipo);
  setVal('os-valor-pago', '');
  setVal('os-tempo-gasto', '');
  setVal('os-add-qtd', 1);

  el('modal-os-titulo').textContent = tipo === 'os' ? 'Nova O.S.' : 'Novo Orçamento';
  el('os-status-badge').textContent = tipo === 'os' ? 'Rascunho' : 'Orçamento';
  el('os-status-badge').className = 'badge';
  el('os-status-container').classList.add('hidden');
  el('os-tempo-container').classList.add('hidden');
  el('os-pagamento-container').classList.add('hidden');
  el('btn-gerar-os').classList.add('hidden');
  el('btn-salvar-os').classList.remove('hidden');
  el('os-status').disabled = false;

  itensTemp = [];
  renderItensOS();
  mudarTipoItemOS();
  abrirModal('modal-os');
}

export const abrirModalOS = () => initModalOS('os');
export const abrirModalOrcamento = () => initModalOS('orcamento');

export function editarOS(id, tipo) {
  const registro = tipo === 'os' ? db.os.find((o) => o.id === id) : db.orcamentos.find((o) => o.id === id);
  if (!registro) return showToast('Registro não encontrado.');

  initModalOS(tipo);
  setVal('os-id', registro.id);
  setVal('os-cli-id', registro.clienteId);
  el('modal-os-titulo').textContent = tipo === 'os' ? `O.S. #${curto(id)}` : `Orç. #${curto(id)}`;

  itensTemp = structuredClone(registro.itens);
  renderItensOS();
  setVal('os-total', Number(registro.valorTotal).toFixed(2));

  if (tipo === 'orcamento') {
    el('btn-gerar-os').classList.remove('hidden');
    return;
  }

  el('os-status-container').classList.remove('hidden');
  el('os-status-badge').textContent = registro.status;
  el('os-status-badge').className = CORES_STATUS[registro.status] ?? 'badge';
  setVal('os-status', registro.status);
  setVal('os-tempo-gasto', registro.tempoGasto || '');

  // Concluída ou cancelada é registro fechado: o servidor recusa alteração.
  const finalizada = registro.status === 'Concluída' || registro.status === 'Cancelada';
  el('os-status').disabled = finalizada;
  el('btn-salvar-os').classList.toggle('hidden', finalizada);
  verificarStatusOS();
}

export function verificarStatusOS() {
  const status = el('os-status').value;
  const finalizada = el('os-status').disabled;

  el('os-tempo-container').classList.toggle('hidden', status === 'Pendente');
  el('os-pagamento-container').classList.toggle('hidden', status !== 'Concluída' || finalizada);
  el('btn-os-cartao')?.classList.toggle('hidden', status !== 'Concluída' || finalizada || !maquininhaDisponivel());

  el('os-status-aviso').textContent =
    {
      Pendente: 'Aguardando: nada é debitado do estoque ainda.',
      Andamento: 'Ao salvar, as peças saem do estoque.',
      Concluída: 'Fecha a OS e lança o valor pago no caixa.',
      Cancelada: 'Cancelar devolve ao estoque as peças já debitadas.'
    }[status] ?? '';

  if (status === 'Concluída' && !finalizada && !el('os-valor-pago').value) {
    setVal('os-valor-pago', el('os-total').dataset.total ?? el('os-total').value);
  }
}

/* -------------------------------- salvar ---------------------------------- */

export async function salvarOS() {
  const id = txt('os-id');
  const tipo = txt('os-tipo');
  if (!itensTemp.length) return showToast('Adicione itens!');

  const corpo = {
    tipo,
    clienteId: txt('os-cli-id'),
    itens: itensTemp.map(({ tipo: t, itemId, qtd }) => ({ tipo: t, itemId, qtd })),
    valorTotal: num('os-total')
  };

  if (tipo === 'os' && id) {
    corpo.status = el('os-status').value;
    corpo.valorPago = num('os-valor-pago');
    corpo.tempoGasto = num('os-tempo-gasto');
  }

  const concluindo = corpo.status === 'Concluída';
  const { ok } = await acao(
    id ? req('PUT', `/ordens/${id}`, corpo) : req('POST', '/ordens', corpo),
    concluindo ? 'O.S. concluída!' : 'Salvo!'
  );
  if (ok) fecharModal('modal-os');
}

export async function transformarOrcamentoEmOS() {
  const id = txt('os-id');
  if (!id) return;
  const { ok } = await acao(req('POST', `/orcamentos/${id}/aprovar`), 'O.S. gerada a partir do orçamento!');
  if (ok) fecharModal('modal-os');
}

/* ------------------------------ central de OS ----------------------------- */

export function abrirCentralOS() {
  const ativas = osAtivas().slice().sort((a, b) => new Date(b.data) - new Date(a.data));

  el('lista-central-os').innerHTML = ativas.length
    ? ativas
        .map((o) => {
          const cor = o.status === 'Andamento' ? 'border-l-blue-500' : 'border-l-gear-orange';
          return `
        <div class="card border-l-4 ${cor} p-3" onclick="App.abrirOSDaCentral('${esc(o.clienteId)}','${esc(o.id)}')">
          <div class="mb-1 flex items-center justify-between">
            <p class="font-bold text-white">${esc(nomeCliente(o.clienteId))}</p>
            <span class="${CORES_STATUS[o.status] ?? 'badge'}">${esc(o.status)}</span>
          </div>
          <div class="flex justify-between text-sm text-slate-400">
            <p>OS #${curto(o.id)}</p>
            <p class="font-bold">${moeda(o.valorTotal)}</p>
          </div>
        </div>`;
        })
        .join('')
    : '<p class="empty-state mt-4">Nenhuma O.S. ativa.</p>';

  abrirModal('modal-central-os');
}

export async function cobrarOSnoCartao() {
  const valor = num('os-valor-pago') || num('os-total');
  if (valor <= 0) return showToast('Valor inválido para cobrar.');
  const id = txt('os-id');
  const descricao = id ? `OS #${id.slice(-4)}` : 'Ordem de serviço';
  const resultado = await cobrarNoCartao(valor, descricao);
  if (resultado?.aprovado) {
    showToast('Pagamento no cartão aprovado! Salve a OS para registrar.');
  }
}
