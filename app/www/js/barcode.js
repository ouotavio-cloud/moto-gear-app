/**
 * Leitura de código de barras.
 *
 * No Android usa o scanner nativo (ML Kit), que abre a câmera em tela cheia.
 * Fora do app (navegador, testes) cai para digitação manual, então todo fluxo
 * que depende de código continua utilizável sem a câmera.
 */

import { plugin } from './files.js';
import { showToast, setVal, el } from './ui.js';
import { buscarPorCodigo, editarProduto, abrirModalProduto } from './estoque.js';

// Valor de CapacitorBarcodeScannerTypeHint.ALL — aceita QR e todos os formatos
// de barra. Como o app roda sem bundler, o enum do plugin vira literal aqui.
const HINT_TODOS = 17;

/** Retorna o código lido, ou string vazia se o usuário cancelar. */
export async function lerCodigo(titulo = 'Aponte para o código de barras') {
  const scanner = plugin('CapacitorBarcodeScanner');

  if (!scanner) {
    const manual = prompt(`${titulo}\n\n(Câmera indisponível aqui — digite o código)`);
    return (manual ?? '').trim();
  }

  try {
    const resultado = await scanner.scanBarcode({
      hint: HINT_TODOS,
      scanInstructions: titulo,
      scanOrientation: 1
    });
    return (resultado?.ScanResult ?? '').trim();
  } catch (err) {
    // Cancelar a leitura rejeita a promise — não é erro que valha aviso.
    console.info('Leitura de código cancelada', err);
    return '';
  }
}

/** Botão dentro do cadastro de produto: preenche o campo de código. */
export async function escanearParaProduto() {
  const codigo = await lerCodigo('Código de barras da peça');
  if (!codigo) return;

  const existente = buscarPorCodigo(codigo);
  const editandoId = el('prod-id').value;
  if (existente && existente.id !== editandoId) {
    return showToast(`Este código já é de "${existente.nome}".`);
  }

  setVal('prod-codigo', codigo);
  showToast(`Código lido: ${codigo}`);
}

/**
 * Botão do estoque: lê o código e vai direto ao produto. Se ninguém tiver esse
 * código, já abre o cadastro com ele preenchido.
 */
export async function escanearNoEstoque() {
  const codigo = await lerCodigo('Código de barras da peça');
  if (!codigo) return;

  const produto = buscarPorCodigo(codigo);
  if (produto) {
    editarProduto(produto.id);
    return;
  }

  showToast('Peça nova — cadastre abaixo.');
  abrirModalProduto({ codigoBarras: codigo });
}
