/** Integração segura com a Mercado Pago Point pela Orders API. */

import { randomUUID } from 'node:crypto';

const BASE = 'https://api.mercadopago.com';

function falha(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function token() {
  const valor = String(process.env.MERCADO_PAGO_ACCESS_TOKEN ?? '').trim();
  if (!valor) throw falha(503, 'Cadastre MERCADO_PAGO_ACCESS_TOKEN no Render para usar a Point Smart 2.');
  return valor;
}

async function chamar(caminho, { method = 'GET', body, idempotencia } = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const texto = await resposta.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { /* resposta externa sem JSON */ }
  if (!resposta.ok) {
    const codigo = dados?.code || dados?.error || dados?.cause?.[0]?.code;
    const detalhe = dados?.message || dados?.error_description;
    const mensagens = {
      already_queued_order_for_terminal: 'A maquininha já possui uma cobrança aguardando. Conclua ou cancele nela e tente novamente.',
      forbidden_checking_terminal_owner: 'Esta Point não está vinculada à mesma conta do Access Token.',
      unauthorized: 'O Access Token do Mercado Pago é inválido. Atualize MERCADO_PAGO_ACCESS_TOKEN no Render.'
    };
    throw falha(resposta.status >= 500 ? 502 : resposta.status, mensagens[codigo] || detalhe || `Mercado Pago recusou a operação (HTTP ${resposta.status}).`);
  }
  return dados;
}

function terminaisDaResposta(dados) {
  if (Array.isArray(dados)) return dados;
  if (Array.isArray(dados?.data?.terminals)) return dados.data.terminals;
  if (Array.isArray(dados?.terminals)) return dados.terminals;
  return [];
}

export async function listarTerminais() {
  return terminaisDaResposta(await chamar('/terminals/v1/list'));
}

async function selecionarTerminal() {
  const terminais = await listarTerminais();
  const definido = String(process.env.MERCADO_PAGO_TERMINAL_ID ?? '').trim();
  const compativeis = terminais.filter((t) => String(t.id ?? '').startsWith('NEWLAND_N950__'));
  const terminal = definido ? terminais.find((t) => t.id === definido) : compativeis.length === 1 ? compativeis[0] : null;

  if (definido && !terminal) throw falha(503, 'MERCADO_PAGO_TERMINAL_ID não pertence à conta configurada.');
  if (!terminal && compativeis.length > 1) throw falha(503, 'Há mais de uma Point Smart 2 na conta. Cadastre MERCADO_PAGO_TERMINAL_ID no Render.');
  if (!terminal) throw falha(503, 'Nenhuma Point Smart 2 (N950) foi encontrada na conta do Mercado Pago.');
  return terminal;
}

async function terminalConfigurado() {
  const terminal = await selecionarTerminal();
  if (terminal.operating_mode !== 'PDV') throw falha(503, 'A Point Smart 2 precisa estar no modo PDV para receber cobranças do Moto Gear.');
  return terminal;
}

export async function statusPoint() {
  if (!String(process.env.MERCADO_PAGO_ACCESS_TOKEN ?? '').trim()) {
    return { disponivel: false, modelo: 'Point Smart 2', motivo: 'Cadastre MERCADO_PAGO_ACCESS_TOKEN no Render.' };
  }
  try {
    const terminal = await selecionarTerminal();
    const pdv = terminal.operating_mode === 'PDV';
    return {
      disponivel: pdv,
      modelo: 'Point Smart 2',
      terminalId: terminal.id,
      identificacao: terminal.external_pos_id || terminal.id.split('__').at(-1),
      modo: terminal.operating_mode,
      requerModoPDV: !pdv,
      motivo: pdv ? undefined : 'Ative o modo PDV e reinicie a Point Smart 2 para receber cobranças.'
    };
  } catch (erro) {
    return { disponivel: false, modelo: 'Point Smart 2', motivo: erro.message };
  }
}

export async function ativarModoPdv() {
  const terminal = await selecionarTerminal();
  if (terminal.operating_mode !== 'PDV') {
    await chamar('/terminals/v1/setup', {
      method: 'PATCH',
      body: { terminals: [{ id: terminal.id, operating_mode: 'PDV' }] }
    });
  }
  return { ok: true, terminalId: terminal.id, modo: 'PDV', reiniciar: true };
}

function formaPagamento(tipo, parcelas) {
  if (tipo === 'debito') return { default_type: 'debit_card', default_installments: 1 };
  if (!['credito_vista', 'credito_parc_vendedor'].includes(tipo)) throw falha(400, 'Forma de pagamento inválida.');
  return {
    default_type: 'credit_card',
    default_installments: tipo === 'credito_vista' ? 1 : parcelas,
    installments_cost: 'seller'
  };
}

export async function criarCobranca({ valor, descricao, tipo, parcelas = 1, referencia }) {
  const numero = Number(valor);
  const qtdParcelas = Number(parcelas);
  if (!Number.isFinite(numero) || numero <= 0) throw falha(400, 'Valor inválido para cobrança.');
  if (!Number.isInteger(qtdParcelas) || qtdParcelas < 1 || qtdParcelas > 12) throw falha(400, 'Parcelamento deve ter entre 1 e 12 parcelas.');

  const terminal = await terminalConfigurado();
  const idempotencia = randomUUID();
  const externa = String(referencia || `motogear_${Date.now()}_${idempotencia.slice(0, 8)}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  const dados = await chamar('/v1/orders', {
    method: 'POST',
    idempotencia,
    body: {
      type: 'point',
      external_reference: externa,
      expiration_time: 'PT16M',
      transactions: { payments: [{ amount: numero.toFixed(2) }] },
      config: {
        point: { terminal_id: terminal.id, print_on_terminal: 'no_ticket' },
        payment_method: formaPagamento(tipo, qtdParcelas)
      },
      description: String(descricao || 'Venda Moto Gear').slice(0, 160)
    }
  });
  return normalizarOrdem(dados);
}

function normalizarOrdem(ordem) {
  const pagamento = ordem?.transactions?.payments?.[0] ?? {};
  return {
    id: ordem?.id,
    status: ordem?.status,
    detalhe: ordem?.status_detail,
    aprovado: ordem?.status === 'processed' && pagamento.status === 'processed',
    pagamentoId: pagamento.id,
    valorPago: Number(pagamento.paid_amount ?? pagamento.amount ?? 0),
    bandeira: pagamento.payment_method?.id ?? '',
    tipo: pagamento.payment_method?.type ?? '',
    parcelas: Number(pagamento.payment_method?.installments ?? 1),
    nsu: pagamento.reference?.id ?? pagamento.reference_id ?? ''
  };
}

export async function consultarCobranca(id) {
  if (!/^ORD[A-Za-z0-9_-]+$/.test(String(id ?? ''))) throw falha(400, 'Identificador da cobrança inválido.');
  return normalizarOrdem(await chamar(`/v1/orders/${encodeURIComponent(id)}`));
}

export async function cancelarCobranca(id) {
  if (!/^ORD[A-Za-z0-9_-]+$/.test(String(id ?? ''))) throw falha(400, 'Identificador da cobrança inválido.');
  return normalizarOrdem(await chamar(`/v1/orders/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    idempotencia: randomUUID()
  }));
}
