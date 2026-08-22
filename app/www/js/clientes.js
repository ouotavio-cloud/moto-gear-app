/** Clientes: cadastro, perfil, histórico de OS/orçamentos e pendências. */

import { db, req, acao } from './api.js';
import { el, esc, moeda, showToast, abrirModal, fecharModal, setVal, txt, marcarSubTab } from './ui.js';
import { clienteAtual, setClienteAtual } from './estado.js';
import { editarOS, abrirCentralOS } from './os.js';
import { cobrarNoCartao, maquininhaDisponivel } from './mercado-pago.js';

export const clientesAtivos = () => db.clientes.filter((c) => c.ativo !== false);

const curto = (id) => String(id).slice(-4);

/** OS concluídas que ainda não foram pagas por inteiro. */
export function pendenciasDe(clienteId) {
  return db.os.filter((o) => o.clienteId === clienteId && o.status === 'Concluída' && (o.valorPago ?? 0) < o.valorTotal);
}

export const totalDevido = (clienteId) =>
  pendenciasDe(clienteId).reduce((acc, o) => acc + (o.valorTotal - (o.valorPago ?? 0)), 0);

export function renderClientes() {
  const busca = (el('busca-cliente')?.value ?? '').toLowerCase();
  const lista = clientesAtivos().filter(
    (c) => c.nome.toLowerCase().includes(busca) || (c.placa ?? '').toLowerCase().includes(busca)
  );

  el('lista-clientes').innerHTML = lista.length
    ? lista
        .map((c) => {
          const abertas = db.os.filter((o) => o.clienteId === c.id && (o.status === 'Pendente' || o.status === 'Andamento')).length;
          const pendencias = pendenciasDe(c.id);
          const devido = totalDevido(c.id);

          const badgeOS = abertas
            ? `<span class="badge ml-2 inline-flex items-center gap-1"><i data-lucide="pin"></i> ${abertas} OS aberta(s)</span>`
            : '';
          const badgePendencia = pendencias.length
            ? `<span class="badge badge-red mt-2 inline-flex items-center gap-1"><i data-lucide="circle-alert"></i> ${pendencias.length} pendência(s) — deve ${moeda(devido)}</span>`
            : '';

          return `
        <div class="card ${pendencias.length ? 'border-2 border-red-500 bg-red-900/20' : ''}" onclick="App.abrirPerfilCliente('${esc(c.id)}')">
          <div class="mb-1 flex flex-wrap items-center"><p class="text-lg font-bold">${esc(c.nome)}</p>${badgeOS}</div>
          <p class="text-sm text-slate-400">
            <i data-lucide="bike"></i> ${esc(c.moto || 'Moto não informada')}
            ${c.placa ? `<span class="font-bold text-gear-orange">${esc(c.placa)}</span>` : ''}
          </p>
          ${badgePendencia}
        </div>`;
        })
        .join('')
    : '<p class="empty-state">Nenhum cliente cadastrado.</p>';
}

/* --------------------------------- CRUD ----------------------------------- */

export function abrirModalCliente() {
  el('modal-cliente-titulo').textContent = 'Novo Cliente';
  for (const campo of ['cli-id', 'cli-nome', 'cli-tel', 'cli-placa', 'cli-moto']) setVal(campo, '');
  abrirModal('modal-cliente');
}

export function editarCliente() {
  const cliente = db.clientes.find((c) => c.id === clienteAtual());
  if (!cliente) return showToast('Cliente não encontrado.');
  el('modal-cliente-titulo').textContent = 'Editar Cliente';
  setVal('cli-id', cliente.id);
  setVal('cli-nome', cliente.nome);
  setVal('cli-tel', cliente.tel);
  setVal('cli-placa', cliente.placa);
  setVal('cli-moto', cliente.moto);
  abrirModal('modal-cliente');
}

export async function salvarCliente() {
  const id = txt('cli-id');
  const nome = txt('cli-nome');
  if (!nome) return showToast('Nome obrigatório.');

  const dados = { nome, tel: txt('cli-tel'), placa: txt('cli-placa'), moto: txt('cli-moto') };
  const { ok } = await acao(id ? req('PUT', `/clientes/${id}`, dados) : req('POST', '/clientes', dados), 'Salvo!');
  if (ok) fecharModal('modal-cliente');
}

export async function excluirCliente() {
  const cliente = db.clientes.find((c) => c.id === clienteAtual());
  if (!cliente) return;
  if (!confirm(`Excluir o cliente "${cliente.nome}"? O histórico de OS continua guardado.`)) return;

  const { ok } = await acao(req('DELETE', `/clientes/${cliente.id}`), 'Cliente excluído!');
  if (ok) {
    fecharModal('perfil-cliente');
    setClienteAtual(null);
  }
}

/* -------------------------------- perfil ---------------------------------- */

let abaPerfil = 'os';

function preencherCabecalhoPerfil(cliente) {
  el('pc-nome').textContent = cliente.nome;
  el('pc-moto').textContent = cliente.moto || 'Moto não informada';
  el('pc-placa').textContent = cliente.placa || '—';
  el('pc-tel').textContent = cliente.tel || 'Sem telefone';
}

export function abrirPerfilCliente(id) {
  const cliente = db.clientes.find((c) => c.id === id);
  if (!cliente) return showToast('Cliente não encontrado.');
  setClienteAtual(id);
  preencherCabecalhoPerfil(cliente);
  setPCTab('os', document.querySelector('#perfil-cliente .sub-tab'));
  abrirModal('perfil-cliente');
}

export function setPCTab(aba, elemento) {
  abaPerfil = aba;
  marcarSubTab('#perfil-cliente', elemento);
  desenharPerfil();
}

/** Redesenha o perfil aberto — chamado junto com o resto da tela após cada operação. */
export function renderPerfil() {
  if (!el('perfil-cliente')?.classList.contains('active')) return;
  const cliente = db.clientes.find((c) => c.id === clienteAtual());
  if (!cliente) return fecharModal('perfil-cliente');
  preencherCabecalhoPerfil(cliente);
  desenharPerfil();
}

function desenharPerfil() {
  const alvo = el('pc-conteudo');
  const id = clienteAtual();

  if (abaPerfil === 'os') {
    const lista = db.os.filter((o) => o.clienteId === id).slice().sort((a, b) => new Date(b.data) - new Date(a.data));
    alvo.innerHTML = lista.length
      ? lista
          .map((o) => {
            const cor =
              o.status === 'Concluída'
                ? 'border-l-green-500'
                : o.status === 'Andamento'
                  ? 'border-l-blue-500'
                  : o.status === 'Cancelada'
                    ? 'border-l-red-500'
                    : 'border-l-gear-orange';
            return `
        <div class="card border-l-4 ${cor} p-3" onclick="App.editarOS('${esc(o.id)}','os')">
          <div class="flex justify-between"><p class="font-bold">OS #${curto(o.id)}</p><p class="font-bold">${moeda(o.valorTotal)}</p></div>
          <p class="mt-1 text-sm text-slate-400">${new Date(o.data).toLocaleDateString('pt-BR')} — <span class="font-bold text-white">${esc(o.status)}</span></p>
        </div>`;
          })
          .join('')
      : '<p class="empty-state">Nenhuma O.S.</p>';
    return;
  }

  if (abaPerfil === 'orcamentos') {
    const lista = db.orcamentos.filter((o) => o.clienteId === id);
    alvo.innerHTML = lista.length
      ? lista
          .map(
            (o) => `
        <div class="card p-3" onclick="App.editarOS('${esc(o.id)}','orcamento')">
          <div class="flex justify-between"><p class="font-bold">Orçamento #${curto(o.id)}</p><p class="font-bold text-gear-orange">${moeda(o.valorTotal)}</p></div>
          <p class="mt-1 text-sm text-slate-400">${new Date(o.data).toLocaleDateString('pt-BR')}</p>
        </div>`
          )
          .join('')
      : '<p class="empty-state">Nenhum orçamento.</p>';
    return;
  }

  const pendencias = pendenciasDe(id);
  alvo.innerHTML = pendencias.length
    ? pendencias
        .map(
          (o) => `
        <div class="card border-l-4 border-l-red-500 p-3">
          <div class="flex justify-between">
            <p class="font-bold">OS #${curto(o.id)}</p>
            <p class="font-bold text-red-500">Deve ${moeda(o.valorTotal - (o.valorPago ?? 0))}</p>
          </div>
          <div class="action-grid mt-3">
            <button onclick="App.quitarPendencia('${esc(o.id)}')" class="btn-success btn-compact">Registrar pagamento</button>
            ${maquininhaDisponivel() ? `<button onclick="App.cobrarPendenciaCartao('${esc(o.id)}')" class="btn-secondary btn-compact"><i data-lucide="credit-card" aria-hidden="true"></i> Cartão</button>` : ''}
          </div>
        </div>`
        )
        .join('')
    : '<p class="empty-state">Nenhuma pendência.</p>';
}

export async function quitarPendencia(osId) {
  const { ok, resultado } = await acao(req('POST', `/os/${osId}/quitar`));
  if (ok) showToast(`Pagamento de ${moeda(resultado.valorRecebido)} registrado!`);
}

export async function cobrarPendenciaCartao(osId) {
  const os = db.os.find((o) => o.id === osId);
  if (!os) return showToast('OS não encontrada.');
  const devido = os.valorTotal - (os.valorPago ?? 0);
  if (devido <= 0) return showToast('Sem valor pendente.');

  const resultado = await cobrarNoCartao(devido, `Pendência OS #${osId.slice(-4)}`);
  if (resultado?.aprovado) {
    const { ok, resultado: quitRes } = await acao(req('POST', `/os/${osId}/quitar`));
    if (ok) showToast(`Pendência quitada no cartão — ${moeda(quitRes.valorRecebido)}`);
  }
}

/** Vem da Central de OS: abre o cliente e já cai na OS clicada. */
export function abrirOSDaCentral(clienteId, osId) {
  fecharModal('modal-central-os');
  abrirPerfilCliente(clienteId);
  editarOS(osId, 'os');
}

export { abrirCentralOS };
