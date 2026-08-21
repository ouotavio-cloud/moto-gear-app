/** Integração PlugPag 4.x com maquininhas PagBank pareadas por Bluetooth. */

import { plugin, isNativo } from './files.js';
import { showToast, abrirModal, fecharModal, el } from './ui.js';

function pp() {
  return plugin('PlugPag');
}

export function maquininhaDisponivel() {
  return isNativo() && pp() != null;
}

let inicializado = false;
let cobrancaEmAndamento = false;
let listenerAtual = null;

function mensagemErro(erro, padrao) {
  return erro?.message || erro?.errorMessage || padrao;
}

function definirStatus(texto, classe = 'text-slate-400') {
  const status = el('pp-status');
  status.textContent = texto;
  status.className = `mt-3 text-center text-sm ${classe}`;
}

function mostrarOpcoes(mostrar) {
  el('pp-opcoes').classList.toggle('hidden', !mostrar);
  el('pp-opcoes').classList.toggle('grid', mostrar);
}

async function removerListener() {
  const listener = await listenerAtual;
  listenerAtual = null;
  try { await listener?.remove?.(); } catch (_) { /* listener já removido */ }
}

export async function garantirInicializado() {
  if (inicializado) return true;
  const p = pp();
  if (!p) return false;
  try {
    definirStatus('Confirmando sua conta PagBank...', 'font-semibold text-gear-orange animate-pulse');
    await p.inicializar({});
    inicializado = true;
    return true;
  } catch (e) {
    console.error('PlugPag init falhou:', e);
    definirStatus(mensagemErro(e, 'Não foi possível entrar no PagBank.'), 'font-semibold text-red-400');
    return false;
  }
}

async function carregarMaquininhas() {
  const select = el('pp-dispositivo');
  const ajuda = el('pp-ajuda-conexao');
  select.innerHTML = '<option value="">Procurando dispositivos pareados...</option>';
  mostrarOpcoes(false);

  try {
    const resposta = await pp().listarDispositivos({});
    const dispositivos = resposta?.dispositivos || [];
    select.innerHTML = '';

    if (!dispositivos.length) {
      select.innerHTML = '<option value="">Nenhuma maquininha pareada</option>';
      ajuda.textContent = 'Abra Configurações > Bluetooth no celular, pareie a maquininha PagBank e volte para tentar novamente.';
      definirStatus('Nenhuma maquininha Bluetooth encontrada.', 'font-semibold text-amber-400');
      return false;
    }

    select.append(new Option('Selecione a maquininha', ''));
    dispositivos.forEach((dispositivo) => {
      const option = new Option(dispositivo.nome, dispositivo.id);
      option.selected = dispositivo.selecionado;
      select.append(option);
    });
    ajuda.textContent = `${dispositivos.length} dispositivo(s) pareado(s). Selecione a maquininha que receberá a cobrança.`;

    const selecionado = dispositivos.find((d) => d.selecionado);
    if (selecionado) {
      select.value = selecionado.id;
      const autenticado = await garantirInicializado();
      mostrarOpcoes(autenticado);
      if (autenticado) definirStatus('Conectada. Escolha a forma de pagamento.', 'font-semibold text-green-400');
      return autenticado;
    }

    definirStatus('Selecione a maquininha para continuar.');
    return false;
  } catch (e) {
    select.innerHTML = '<option value="">Não foi possível procurar</option>';
    definirStatus(mensagemErro(e, 'Não foi possível procurar maquininhas.'), 'font-semibold text-red-400');
    return false;
  }
}

export async function selecionarMaquininha() {
  const id = el('pp-dispositivo').value;
  if (!id) {
    showToast('Selecione uma maquininha pareada.');
    return;
  }

  const botao = el('btn-pp-conectar');
  botao.disabled = true;
  definirStatus('Preparando conexão segura...', 'font-semibold text-gear-orange animate-pulse');
  try {
    await pp().selecionarDispositivo({ id });
    inicializado = false;
    const autenticado = await garantirInicializado();
    mostrarOpcoes(autenticado);
    if (autenticado) definirStatus('Conectada. Escolha a forma de pagamento.', 'font-semibold text-green-400');
  } catch (e) {
    definirStatus(mensagemErro(e, 'Não foi possível selecionar a maquininha.'), 'font-semibold text-red-400');
  } finally {
    botao.disabled = false;
  }
}

export async function cobrarNoCartao(valorReais, descricao) {
  if (!maquininhaDisponivel()) {
    showToast('A integração com maquininha está disponível somente no aplicativo Android.');
    return null;
  }
  if (!Number.isFinite(valorReais) || valorReais <= 0) {
    showToast('O valor da cobrança é inválido.');
    return null;
  }

  el('pp-valor').textContent = valorReais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  el('pp-desc').textContent = descricao || '';
  el('pp-resultado').classList.add('hidden');
  el('pp-parcelas-sel').classList.add('hidden');
  el('btn-pp-abortar').classList.add('hidden');
  definirStatus('Procurando sua maquininha...', 'font-semibold text-gear-orange animate-pulse');
  window._ppValor = valorReais;
  abrirModal('modal-plugpag');
  carregarMaquininhas();

  return new Promise((resolve) => {
    window._ppResolve = resolve;
  });
}

export async function executarCobranca(tipo, parcelas = 1) {
  if (cobrancaEmAndamento) return null;
  const valorReais = Number(window._ppValor);
  const valorCentavos = Math.round(valorReais * 100);
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    definirStatus('Valor inválido para cobrança.', 'font-semibold text-red-400');
    return null;
  }

  cobrancaEmAndamento = true;
  mostrarOpcoes(false);
  el('btn-pp-abortar').classList.remove('hidden');
  definirStatus('Conectando. Aguarde a instrução na maquininha...', 'font-bold text-gear-orange animate-pulse');

  const p = pp();
  listenerAtual = p.addListener('plugpagEvento', (evento) => {
    if (evento.mensagem) definirStatus(evento.mensagem, 'font-bold text-gear-orange animate-pulse');
  });

  try {
    const resultado = await p.pagar({ valorCentavos, tipo, parcelas });
    await removerListener();
    el('btn-pp-abortar').classList.add('hidden');

    if (!resultado?.aprovado) throw new Error('Pagamento não aprovado.');
    definirStatus('Pagamento aprovado!', 'font-bold text-green-400');
    el('pp-resultado').classList.remove('hidden');
    el('pp-bandeira').textContent = resultado.bandeira || '—';
    el('pp-nsu').textContent = resultado.nsu || '—';
    el('pp-autorizacao').textContent = resultado.transacaoCode || '—';

    const resolver = window._ppResolve;
    window._ppResolve = null;
    setTimeout(() => {
      fecharModal('modal-plugpag');
      resolver?.(resultado);
    }, 1200);
    return resultado;
  } catch (e) {
    await removerListener();
    el('btn-pp-abortar').classList.add('hidden');
    definirStatus(mensagemErro(e, 'Pagamento recusado ou não concluído.'), 'font-bold text-red-400');
    mostrarOpcoes(true);
    return null;
  } finally {
    cobrancaEmAndamento = false;
  }
}

export async function abortarPagamento() {
  try { await pp()?.abortar({}); } catch (_) { /* o terminal pode já ter encerrado */ }
  await removerListener();
  cobrancaEmAndamento = false;
  el('btn-pp-abortar').classList.add('hidden');
  definirStatus('Pagamento cancelado.', 'font-semibold text-red-400');
  mostrarOpcoes(true);
}

export async function fecharPlugPag() {
  if (cobrancaEmAndamento) await abortarPagamento();
  await removerListener();
  fecharModal('modal-plugpag');
  const resolver = window._ppResolve;
  window._ppResolve = null;
  resolver?.(null);
}

export function escolherParcelas() {
  el('pp-parcelas-sel').classList.toggle('hidden');
}
