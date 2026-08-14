/**
 * Utilidades de interface: seletores, formatação, toast, modais e navegação.
 *
 * Este módulo não conhece nenhuma regra de negócio — os módulos de domínio é que
 * registram suas funções de render aqui (`setRenderers`), o que evita
 * dependência circular entre eles.
 */

export const el = (id) => document.getElementById(id);

/** Escapa texto vindo do usuário antes de entrar em template de HTML. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const FORMATO_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * R$ 1.234,56 — para exibição. Nunca use em CSV.
 * Valor negativo sai como "-R$ 200,00" (e não "R$ -200,00").
 */
export function moeda(valor) {
  return FORMATO_MOEDA.format(Number(valor) || 0).replace(/ /g, ' ');
}

export function num(id) {
  return parseFloat(el(id)?.value) || 0;
}

export function int(id) {
  return parseInt(el(id)?.value, 10) || 0;
}

export function txt(id) {
  return (el(id)?.value ?? '').trim();
}

export function setVal(id, value) {
  const node = el(id);
  if (node) node.value = value ?? '';
}

let toastTimer = null;

export function showToast(mensagem) {
  const node = el('toast');
  if (!node) return;
  node.textContent = mensagem;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
}

/** Overlay bloqueante para operações demoradas (leitura de nota, por exemplo). */
export function carregando(texto) {
  el('carregando-texto').textContent = texto;
  el('overlay-carregando').classList.add('active');
}

export function pararCarregando() {
  el('overlay-carregando').classList.remove('active');
}

export function abrirModal(id) {
  el(id)?.classList.add('active');
}

export function fecharModal(id) {
  el(id)?.classList.remove('active');
}

/* ------------------------------- navegação -------------------------------- */

let renderers = {};

/** main.js registra aqui o que cada aba deve renderizar. */
export function setRenderers(map) {
  renderers = map;
}

export function renderTab(tab) {
  renderers[tab]?.();
}

/** Redesenha todas as abas — usado depois de qualquer alteração de dados. */
export function renderAll() {
  for (const render of Object.values(renderers)) render();
}

export function switchTab(tabId, elemento) {
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
  el('tab-' + tabId)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((c) => c.classList.remove('active'));
  elemento?.classList.add('active');
  renderTab(tabId);
}

/** Marca a sub-aba clicada como ativa dentro de um container. */
export function marcarSubTab(containerSelector, elemento) {
  document.querySelectorAll(`${containerSelector} .sub-tab`).forEach((c) => c.classList.remove('active'));
  elemento?.classList.add('active');
}
