/**
 * Conversão entre linha do banco e o formato que o app consome.
 *
 * Os drivers divergem em tipos (NUMERIC vem como string no `pg`, datas como
 * Date), então a coerção fica concentrada aqui em vez de espalhada nas rotas.
 */

const numero = (v) => Number(v ?? 0);
const texto = (v) => String(v ?? '');
const dataIso = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const lista = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v || '[]') : (v ?? []));

export const produto = (r) => ({
  id: r.id,
  nome: r.nome,
  categoria: texto(r.categoria),
  marca: texto(r.marca),
  codigoBarras: texto(r.codigo_barras),
  custo: numero(r.custo),
  venda: numero(r.venda),
  qtd: numero(r.qtd),
  min: numero(r.minimo),
  ativo: Boolean(r.ativo)
});

export const servico = (r) => ({
  id: r.id,
  nome: r.nome,
  valor: numero(r.valor),
  pecas: lista(r.pecas).map((p) => ({ produtoId: p.produtoId, qtd: numero(p.qtd) })),
  ativo: Boolean(r.ativo)
});

export const cliente = (r) => ({
  id: r.id,
  nome: r.nome,
  tel: texto(r.tel),
  placa: texto(r.placa),
  moto: texto(r.moto),
  ativo: Boolean(r.ativo)
});

export const fornecedor = (r) => ({
  id: r.id,
  nome: r.nome,
  cnpj: texto(r.cnpj),
  tel: texto(r.tel),
  vendedor: texto(r.vendedor),
  obs: texto(r.obs),
  ativo: Boolean(r.ativo)
});

export const ordem = (r) => ({
  id: r.id,
  clienteId: r.cliente_id,
  data: dataIso(r.data),
  itens: lista(r.itens).map((i) => ({
    tipo: i.tipo,
    itemId: i.itemId,
    nome: i.nome,
    qtd: numero(i.qtd),
    total: numero(i.total)
  })),
  valorTotal: numero(r.valor_total),
  status: r.status,
  estoqueDebitado: Boolean(r.estoque_debitado),
  valorPago: numero(r.valor_pago),
  tempoGasto: numero(r.tempo_gasto)
});

export const transacao = (r) => {
  const saida = {
    id: r.id,
    desc: r.descricao,
    valor: numero(r.valor),
    tipo: r.tipo,
    data: dataIso(r.data),
    clienteNome: texto(r.cliente_nome),
    origemDetalhada: texto(r.origem_detalhada)
  };
  if (r.origem) saida.origem = r.origem;
  if (r.itens) saida.itens = lista(r.itens);
  return saida;
};
