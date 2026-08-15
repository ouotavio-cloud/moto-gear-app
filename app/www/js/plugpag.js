/**
 * Ponte com o plugin nativo PlugPag (maquininha PagBank Moderninha).
 *
 * No navegador ou sem o plugin, tudo é no-op com mensagem amigável.
 */

import { plugin, isNativo } from './files.js';
import { showToast, abrirModal, fecharModal, el } from './ui.js';

function pp() {
  return plugin('PlugPag');
}

export function maquininhaDisponivel() {
  return isNativo() && pp() != null;
}

let inicializado = false;

export async function garantirInicializado() {
  if (inicializado) return true;
  const p = pp();
  if (!p) return false;
  try {
    await p.inicializar({ codigoAtivacao: '' });
    inicializado = true;
    return true;
  } catch (e) {
    console.error('PlugPag init falhou:', e);
    return false;
  }
}

export async function cobrarNoCartao(valorReais, descricao) {
  if (!maquininhaDisponivel()) {
    showToast('Maquininha não disponível neste dispositivo.');
    return null;
  }

  const ok = await garantirInicializado();
  if (!ok) {
    showToast('Não foi possível conectar à maquininha.');
    return null;
  }

  el('pp-valor').textContent = valorReais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  el('pp-desc').textContent = descricao || '';
  el('pp-status').textContent = 'Escolha a forma de pagamento';
  el('pp-status').className = 'mt-3 text-center text-sm text-slate-400';
  el('pp-resultado').classList.add('hidden');
  el('pp-opcoes').classList.remove('hidden');
  el('btn-pp-abortar').classList.add('hidden');

  return new Promise((resolve) => {
    window._ppResolve = resolve;
    window._ppValor = valorReais;
    abrirModal('modal-plugpag');
  });
}

export async function executarCobranca(tipo, parcelas) {
  const valorReais = window._ppValor;
  const valorCentavos = Math.round(valorReais * 100);

  el('pp-opcoes').classList.add('hidden');
  el('btn-pp-abortar').classList.remove('hidden');
  el('pp-status').textContent = 'Aproxime, insira ou passe o cartão na maquininha...';
  el('pp-status').className = 'mt-3 text-center text-sm font-bold text-gear-orange animate-pulse';

  const p = pp();
  const listener = p.addListener('plugpagEvento', (evento) => {
    if (evento.mensagem) {
      el('pp-status').textContent = evento.mensagem;
    }
  });

  try {
    const resultado = await p.pagar({ valorCentavos, tipo, parcelas: parcelas || 1 });

    listener.remove();
    el('btn-pp-abortar').classList.add('hidden');

    if (resultado.aprovado) {
      el('pp-status').textContent = 'Pagamento aprovado!';
      el('pp-status').className = 'mt-3 text-center text-sm font-bold text-green-400';
      el('pp-resultado').classList.remove('hidden');
      el('pp-bandeira').textContent = resultado.bandeira || '';
      el('pp-nsu').textContent = resultado.nsu || '';
      el('pp-autorizacao').textContent = resultado.autoCode || '';

      setTimeout(() => {
        fecharModal('modal-plugpag');
        if (window._ppResolve) window._ppResolve(resultado);
      }, 2000);
    }

    return resultado;
  } catch (e) {
    listener.remove();
    el('btn-pp-abortar').classList.add('hidden');
    el('pp-status').textContent = e.message || 'Pagamento recusado';
    el('pp-status').className = 'mt-3 text-center text-sm font-bold text-red-400';

    el('pp-opcoes').classList.remove('hidden');
    return null;
  }
}

export async function abortarPagamento() {
  try {
    await pp()?.abortar({});
  } catch (_) { /* ignora */ }
  el('btn-pp-abortar').classList.add('hidden');
  el('pp-status').textContent = 'Pagamento cancelado';
  el('pp-status').className = 'mt-3 text-center text-sm text-red-400';
  el('pp-opcoes').classList.remove('hidden');
}

export function fecharPlugPag() {
  fecharModal('modal-plugpag');
  if (window._ppResolve) {
    window._ppResolve(null);
    window._ppResolve = null;
  }
}

export function escolherParcelas() {
  const sel = el('pp-parcelas-sel');
  if (sel.classList.contains('hidden')) {
    sel.classList.remove('hidden');
  } else {
    const parcelas = parseInt(el('pp-parcelas-qtd').value) || 2;
    executarCobranca('credito_parc', parcelas);
  }
}
