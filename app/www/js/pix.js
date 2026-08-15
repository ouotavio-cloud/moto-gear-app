/**
 * Pagamento por Pix.
 *
 * Monta o "copia e cola" (BR Code, padrão EMV do Banco Central) e o QR Code no
 * valor exato da venda, a partir da chave Pix que a oficina cadastrou. Não
 * depende de maquininha nem de gateway: o cliente paga na chave e o operador
 * confirma o recebimento com um toque — é a confirmação que fecha a venda
 * (baixa o estoque e lança no caixa). O QR é gerado localmente (vendor/qrcode).
 */

import { req } from './api.js';
import { el, showToast, abrirModal, fecharModal } from './ui.js';

let configPix = { chave: '', nome: '', cidade: '' };

export function pixConfig() {
  return configPix;
}

export function pixDisponivel() {
  return Boolean(configPix.chave);
}

export function setConfigPix(pix) {
  configPix = { chave: '', nome: '', cidade: '', ...(pix ?? {}) };
}

/** Busca a chave Pix da oficina no servidor. Silencioso: sem config, o botão Pix só não aparece. */
export async function carregarConfigPix() {
  try {
    const org = await req('GET', '/auth/organizacao');
    setConfigPix(org.pix);
  } catch (err) {
    console.error('Não consegui carregar a configuração do Pix', err);
  }
  return configPix;
}

/* ------------------------- BR Code (Pix copia e cola) ---------------------- */

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// EMV: cada campo é ID (2 dígitos) + tamanho (2 dígitos) + valor.
function campo(id, valor) {
  const v = String(valor);
  return id + String(v.length).padStart(2, '0') + v;
}

// CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), calculado sobre a string
// inteira já com "6304" no fim. Resultado em hexadecimal maiúsculo, 4 dígitos.
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Monta o BR Code estático com valor. `nome` e `cidade` do recebedor só aceitam
 * ASCII maiúsculo e têm limite de tamanho no padrão — daí a limpeza aqui.
 */
export function montarBRCode({ chave, nome, cidade, valor, txid = '***' }) {
  const nomeLimpo = semAcento(nome).toUpperCase().slice(0, 25) || 'RECEBEDOR';
  const cidadeLimpa = semAcento(cidade).toUpperCase().slice(0, 15) || 'CIDADE';
  const valorStr = (Math.round((Number(valor) || 0) * 100) / 100).toFixed(2);

  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', String(chave ?? '').trim());
  const adicional = campo('05', String(txid).slice(0, 25) || '***');

  let payload =
    campo('00', '01') + // formato do payload
    campo('26', conta) + // conta do recebedor (a chave Pix)
    campo('52', '0000') + // código de categoria
    campo('53', '986') + // moeda: BRL
    campo('54', valorStr) + // valor
    campo('58', 'BR') + // país
    campo('59', nomeLimpo) + // nome do recebedor
    campo('60', cidadeLimpa) + // cidade do recebedor
    campo('62', adicional); // dados adicionais (txid)

  payload += '6304'; // id e tamanho do CRC, que entram no cálculo do próprio CRC
  return payload + crc16(payload);
}

/* ---------------------------------- modal ---------------------------------- */

function renderQR(texto) {
  const box = el('pix-qr');
  box.innerHTML = '';
  const gerar = globalThis.qrcode;
  if (typeof gerar !== 'function') {
    box.textContent = 'QR indisponível — use o copia e cola.';
    return;
  }
  const qr = gerar(0, 'M');
  qr.addData(texto);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 12, scalable: true });
}

/**
 * Abre o modal do Pix no valor pedido e resolve `{aprovado:true}` se o operador
 * confirmar o recebimento, ou `null` se cancelar. Espelha `cobrarNoCartao`.
 */
export async function cobrarNoPix(valorReais, descricao) {
  if (!pixDisponivel()) {
    showToast('Cadastre a chave Pix em Configurações antes de cobrar por Pix.');
    return null;
  }

  const brcode = montarBRCode({
    chave: configPix.chave,
    nome: configPix.nome,
    cidade: configPix.cidade,
    valor: valorReais
  });

  el('pix-valor').textContent = valorReais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  el('pix-desc').textContent = descricao || '';
  el('pix-copia').value = brcode;
  renderQR(brcode);

  return new Promise((resolve) => {
    window._pixResolve = resolve;
    abrirModal('modal-pix');
  });
}

export async function copiarPix() {
  const texto = el('pix-copia').value;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const campoTexto = el('pix-copia');
    campoTexto.removeAttribute('readonly');
    campoTexto.select();
    document.execCommand?.('copy');
    campoTexto.setAttribute('readonly', 'readonly');
  }
  showToast('Código Pix copiado!');
}

export function confirmarRecebimentoPix() {
  fecharModal('modal-pix');
  if (window._pixResolve) {
    window._pixResolve({ aprovado: true, brcode: el('pix-copia').value });
    window._pixResolve = null;
  }
}

export function fecharPix() {
  fecharModal('modal-pix');
  if (window._pixResolve) {
    window._pixResolve(null);
    window._pixResolve = null;
  }
}
