/** Cobrança na Mercado Pago Point Smart 2 por meio do backend do Moto Gear. */

import { req } from './api.js';
import { showToast, abrirModal, fecharModal, el } from './ui.js';

let cobrancaEmAndamento = false;
let ordemAtual = '';
let canceladoLocalmente = false;

export function maquininhaDisponivel() {
  // A integração é pela internet e funciona no APK e no navegador. O endpoint
  // de status explica dentro do modal caso ainda falte configuração no Render.
  return true;
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

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mensagemStatus(status) {
  return {
    created: 'Cobrança enviada. Aguarde aparecer na Point Smart 2…',
    at_terminal: 'Cobrança recebida. Siga as instruções na maquininha…',
    action_required: 'Confira o resultado diretamente na maquininha antes de registrar a venda.',
    failed: 'Pagamento recusado ou não concluído.',
    canceled: 'Pagamento cancelado.',
    expired: 'A cobrança expirou. Tente novamente.',
    refunded: 'Pagamento estornado.'
  }[status] || 'Consultando pagamento…';
}

async function carregarPoint() {
  mostrarOpcoes(false);
  definirStatus('Localizando sua Point Smart 2…', 'font-semibold text-gear-orange animate-pulse');
  try {
    const status = await req('GET', '/maquininha/status');
    el('pp-dispositivo').textContent = status.identificacao || 'Point Smart 2';
    el('pp-modo').textContent = status.modo || '—';
    el('btn-pp-ativar-pdv').classList.toggle('hidden', !status.requerModoPDV);
    if (!status.disponivel) throw new Error(status.motivo || 'A maquininha ainda não está configurada.');
    mostrarOpcoes(true);
    definirStatus('Pronta. Escolha débito, crédito ou parcelamento.', 'font-semibold text-green-400');
    return true;
  } catch (erro) {
    definirStatus(erro.message, 'font-semibold text-red-400');
    return false;
  }
}

export async function ativarModoPdv() {
  const botao = el('btn-pp-ativar-pdv');
  botao.disabled = true;
  definirStatus('Ativando o modo PDV…', 'font-semibold text-gear-orange animate-pulse');
  try {
    await req('POST', '/maquininha/modo-pdv');
    botao.classList.add('hidden');
    el('pp-modo').textContent = 'PDV';
    definirStatus('Modo PDV ativado. Reinicie a Point Smart 2 e depois abra esta cobrança novamente.', 'font-semibold text-green-400');
  } catch (erro) {
    definirStatus(erro.message, 'font-semibold text-red-400');
  } finally {
    botao.disabled = false;
  }
}

export async function cobrarNoCartao(valorReais, descricao) {
  if (!Number.isFinite(valorReais) || valorReais <= 0) {
    showToast('O valor da cobrança é inválido.');
    return null;
  }

  el('pp-valor').textContent = valorReais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  el('pp-desc').textContent = descricao || '';
  el('pp-resultado').classList.add('hidden');
  el('pp-parcelas-sel').classList.add('hidden');
  el('btn-pp-abortar').classList.add('hidden');
  el('btn-pp-ativar-pdv').classList.add('hidden');
  window._ppValor = valorReais;
  window._ppDescricao = descricao || 'Venda Moto Gear';
  abrirModal('modal-plugpag');
  carregarPoint();

  return new Promise((resolve) => { window._ppResolve = resolve; });
}

export async function executarCobranca(tipo, parcelas = 1) {
  if (cobrancaEmAndamento) return null;
  cobrancaEmAndamento = true;
  canceladoLocalmente = false;
  mostrarOpcoes(false);
  el('btn-pp-abortar').classList.remove('hidden');
  definirStatus('Enviando o valor para a Point Smart 2…', 'font-bold text-gear-orange animate-pulse');

  try {
    let resultado = await req('POST', '/maquininha/cobrancas', {
      valor: Number(window._ppValor),
      descricao: window._ppDescricao,
      tipo,
      parcelas
    });
    ordemAtual = resultado.id;

    for (let tentativa = 0; tentativa < 300 && !canceladoLocalmente; tentativa += 1) {
      definirStatus(mensagemStatus(resultado.status), 'font-bold text-gear-orange animate-pulse');
      if (resultado.aprovado) {
        el('btn-pp-abortar').classList.add('hidden');
        definirStatus('Pagamento aprovado!', 'font-bold text-green-400');
        el('pp-resultado').classList.remove('hidden');
        el('pp-bandeira').textContent = (resultado.bandeira || resultado.tipo || 'Cartão').toUpperCase();
        el('pp-nsu').textContent = resultado.nsu || resultado.pagamentoId || '—';
        el('pp-autorizacao').textContent = `${resultado.parcelas || 1}x`;
        const resolver = window._ppResolve;
        window._ppResolve = null;
        ordemAtual = '';
        setTimeout(() => {
          fecharModal('modal-plugpag');
          resolver?.(resultado);
        }, 900);
        return resultado;
      }
      if (['failed', 'canceled', 'expired', 'refunded', 'action_required'].includes(resultado.status)) {
        throw new Error(mensagemStatus(resultado.status));
      }
      await esperar(2000);
      resultado = await req('GET', `/maquininha/cobrancas/${encodeURIComponent(ordemAtual)}`);
    }
    if (!canceladoLocalmente) throw new Error('Tempo de espera esgotado. Confira a cobrança na maquininha.');
    return null;
  } catch (erro) {
    if (!canceladoLocalmente) definirStatus(erro.message, 'font-bold text-red-400');
    el('btn-pp-abortar').classList.add('hidden');
    mostrarOpcoes(!canceladoLocalmente);
    return null;
  } finally {
    cobrancaEmAndamento = false;
  }
}

export async function abortarPagamento() {
  canceladoLocalmente = true;
  const id = ordemAtual;
  ordemAtual = '';
  if (id) {
    try { await req('POST', `/maquininha/cobrancas/${encodeURIComponent(id)}/cancelar`); } catch (_) { /* pode ter encerrado no terminal */ }
  }
  el('btn-pp-abortar').classList.add('hidden');
  definirStatus('Pagamento cancelado.', 'font-semibold text-red-400');
  mostrarOpcoes(true);
}

export async function fecharPlugPag() {
  if (cobrancaEmAndamento || ordemAtual) await abortarPagamento();
  fecharModal('modal-plugpag');
  const resolver = window._ppResolve;
  window._ppResolve = null;
  resolver?.(null);
}

export function escolherParcelas() {
  el('pp-parcelas-sel').classList.toggle('hidden');
}
