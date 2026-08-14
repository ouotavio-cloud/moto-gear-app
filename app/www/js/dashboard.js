/** Tela inicial: saldo, contadores, alertas e as últimas transações. */

import { db } from './api.js';
import { el, moeda } from './ui.js';
import { saldo, htmlTransacoes } from './caixa.js';
import { renderAlertas, totalUnidades } from './estoque.js';
import { osAtivas } from './os.js';

const ULTIMAS = 15;

export function renderDashboard() {
  el('dash-saldo').textContent = moeda(saldo());
  el('dash-itens').textContent = totalUnidades();
  el('dash-os').textContent = osAtivas().length;
  renderAlertas();
  el('dash-transacoes').innerHTML = htmlTransacoes(db.transacoes.slice(-ULTIMAS).reverse());
}
