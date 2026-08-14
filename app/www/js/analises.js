/** Análises: resultado geral, ranking de peças, lucratividade e fechamento mensal. */

import { db } from './api.js';
import { el, esc, moeda, marcarSubTab } from './ui.js';
import { produtosAtivos } from './estoque.js';

const entradas = () => db.transacoes.filter((t) => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0);
const saidas = () => db.transacoes.filter((t) => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0);

/**
 * Unidades vendidas por item. Soma as OS concluídas com as vendas de balcão;
 * o fechamento de OS também gera transação, por isso só entram as transações
 * marcadas como `origem: 'venda'` — senão a mesma peça contaria duas vezes.
 */
function ranking() {
  const total = new Map();
  const somar = (itens) => {
    for (const item of itens ?? []) {
      const atual = total.get(item.nome) ?? 0;
      total.set(item.nome, atual + (Number(item.qtd) || 0));
    }
  };

  db.os.filter((o) => o.status === 'Concluída').forEach((o) => somar(o.itens));
  db.transacoes.filter((t) => t.origem === 'venda').forEach((t) => somar(t.itens));

  return [...total].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd);
}

function barra(rotulo, valorTexto, percentual) {
  return `
    <div class="mb-3">
      <div class="flex justify-between text-sm"><span>${esc(rotulo)}</span><span>${esc(valorTexto)}</span></div>
      <div class="bar-chart"><div class="bar-fill" style="width: ${Math.max(2, Math.min(percentual, 100))}%"></div></div>
    </div>`;
}

function abaGeral() {
  const receita = entradas();
  const despesa = saidas();
  const lucro = receita - despesa;
  return `
    <div class="card mb-4 text-center"><p class="text-slate-400">Receitas</p><h2 class="text-3xl font-bold text-green-500">${moeda(receita)}</h2></div>
    <div class="card mb-4 text-center"><p class="text-slate-400">Despesas</p><h2 class="text-3xl font-bold text-red-500">${moeda(despesa)}</h2></div>
    <div class="card text-center"><p class="text-slate-400">Resultado</p><h2 class="text-3xl font-bold ${lucro >= 0 ? 'text-green-500' : 'text-red-500'}">${moeda(lucro)}</h2></div>`;
}

function abaProdutos() {
  const vendidos = ranking().slice(0, 10);
  const maior = vendidos[0]?.qtd ?? 1;
  const estoque = produtosAtivos().slice().sort((a, b) => b.qtd - a.qtd).slice(0, 10);
  const maiorEstoque = estoque[0]?.qtd ?? 1;

  return `
    <h3 class="mb-3 font-bold text-gear-orange">Mais vendidos</h3>
    ${vendidos.length ? vendidos.map((v) => barra(v.nome, `${v.qtd} un`, (v.qtd / maior) * 100)).join('') : '<p class="mb-4 text-slate-500">Nenhuma venda registrada ainda.</p>'}
    <h3 class="mb-3 mt-6 font-bold text-gear-orange">Maiores estoques hoje</h3>
    ${estoque.length ? estoque.map((p) => barra(p.nome, `${p.qtd} un`, (p.qtd / maiorEstoque) * 100)).join('') : '<p class="text-slate-500">Estoque vazio.</p>'}`;
}

function abaServicos() {
  const stats = new Map();

  for (const os of db.os.filter((o) => o.status === 'Concluída')) {
    const servicos = os.itens.filter((i) => i.tipo === 'servico');
    const totalMaoDeObra = servicos.reduce((a, s) => a + s.total, 0);

    for (const servico of servicos) {
      const atual = stats.get(servico.nome) ?? { faturado: 0, minutos: 0, qtd: 0 };
      atual.faturado += servico.total;
      atual.qtd += servico.qtd;
      // O tempo da OS é rateado entre os serviços proporcionalmente ao valor.
      if (totalMaoDeObra > 0) atual.minutos += (os.tempoGasto ?? 0) * (servico.total / totalMaoDeObra);
      stats.set(servico.nome, atual);
    }
  }

  const linhas = [...stats]
    .map(([nome, s]) => {
      const horas = s.minutos / 60;
      return { nome, ...s, porHora: horas > 0 ? s.faturado / horas : null };
    })
    .sort((a, b) => (b.porHora ?? -1) - (a.porHora ?? -1));

  if (!linhas.length) return '<p class="text-slate-500">Nenhuma O.S. concluída ainda.</p>';

  const maior = linhas.find((l) => l.porHora)?.porHora ?? 1;

  return (
    '<h3 class="mb-3 font-bold text-gear-orange">Lucratividade da mão de obra</h3>' +
    linhas
      .map((l) => {
        const valor = l.porHora ? `${moeda(l.porHora)}/h` : 'sem tempo informado';
        return `
      <div class="mb-3">
        <div class="flex justify-between text-sm">
          <span class="font-bold">${esc(l.nome)} (${l.qtd}x)</span>
          <span class="font-bold ${l.porHora ? 'text-green-500' : 'text-slate-500'}">${valor}</span>
        </div>
        <p class="mb-1 text-xs text-slate-500">Faturado: ${moeda(l.faturado)} · tempo lançado: ${Math.round(l.minutos)} min</p>
        <div class="bar-chart !h-2"><div class="bar-fill" style="width: ${l.porHora ? Math.min((l.porHora / maior) * 100, 100) : 0}%"></div></div>
      </div>`;
      })
      .join('') +
    '<p class="mt-4 text-xs text-slate-500">Preencha o "tempo gasto" ao concluir a O.S. para o R$/hora aparecer.</p>'
  );
}

function abaMensal() {
  const meses = new Map();
  for (const t of db.transacoes) {
    const chave = t.data.slice(0, 7);
    const atual = meses.get(chave) ?? { entrada: 0, saida: 0 };
    atual[t.tipo === 'entrada' ? 'entrada' : 'saida'] += t.valor;
    meses.set(chave, atual);
  }

  const ordenados = [...meses.keys()].sort().reverse();
  if (!ordenados.length) return '<p class="text-slate-500">Sem dados mensais.</p>';

  return (
    '<h3 class="mb-3 font-bold text-gear-orange">Resumo mensal</h3>' +
    ordenados
      .map((chave) => {
        const { entrada, saida } = meses.get(chave);
        const lucro = entrada - saida;
        const [ano, mes] = chave.split('-');
        const nomeMes = new Date(Number(ano), Number(mes) - 1, 1)
          .toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
          .toUpperCase();
        return `
      <div class="card mb-3 border-l-4 ${lucro >= 0 ? 'border-l-green-500' : 'border-l-red-500'} p-3">
        <p class="mb-2 font-bold">${esc(nomeMes)}</p>
        <div class="flex justify-between text-sm text-slate-300"><span>Entradas:</span><span class="text-green-500">${moeda(entrada)}</span></div>
        <div class="mb-2 flex justify-between text-sm text-slate-300"><span>Saídas:</span><span class="text-red-500">${moeda(saida)}</span></div>
        <div class="flex justify-between border-t border-gear-700 pt-2 font-bold">
          <span>Lucro líquido:</span><span class="${lucro >= 0 ? 'text-green-500' : 'text-red-500'}">${moeda(lucro)}</span>
        </div>
      </div>`;
      })
      .join('')
  );
}

const ABAS = { geral: abaGeral, produtos: abaProdutos, servicos: abaServicos, mensal: abaMensal };

let abaAtiva = 'geral';

export function setAnaliseTab(aba, elemento) {
  abaAtiva = ABAS[aba] ? aba : 'geral';
  marcarSubTab('#tab-analises', elemento);
  el('conteudo-analises').innerHTML = ABAS[abaAtiva]();
}

export function renderAnalises() {
  if (!el('tab-analises')?.classList.contains('active')) return;
  el('conteudo-analises').innerHTML = ABAS[abaAtiva]();
}
