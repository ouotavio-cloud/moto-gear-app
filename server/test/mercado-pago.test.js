import test from 'node:test';
import assert from 'node:assert/strict';
import { criarCobranca, statusPoint } from '../src/mercado-pago.js';

const TERMINAL = 'NEWLAND_N950__N950NCB801293324';

test('Point Smart 2 é localizada e recebe valor, crédito e parcelas pela Orders API', async () => {
  const fetchOriginal = globalThis.fetch;
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'APP_USR_TESTE';
  delete process.env.MERCADO_PAGO_TERMINAL_ID;
  const chamadas = [];

  globalThis.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes });
    if (String(url).endsWith('/terminals/v1/list')) {
      return new Response(JSON.stringify({ data: { terminals: [{ id: TERMINAL, operating_mode: 'PDV' }] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({
      id: 'ORD_TESTE_1',
      status: 'created',
      status_detail: 'created',
      transactions: { payments: [{ id: 'PAY_TESTE_1', amount: '67.89', status: 'created' }] }
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const status = await statusPoint();
    assert.equal(status.disponivel, true);
    assert.equal(status.terminalId, TERMINAL);

    const ordem = await criarCobranca({ valor: 67.89, descricao: 'Kit freio', tipo: 'credito_parc_vendedor', parcelas: 3 });
    assert.equal(ordem.id, 'ORD_TESTE_1');
    const envio = chamadas.find((c) => c.url.endsWith('/v1/orders'));
    assert.ok(envio.opcoes.headers['X-Idempotency-Key']);
    assert.equal(envio.opcoes.headers.Authorization, 'Bearer APP_USR_TESTE');
    assert.deepEqual(JSON.parse(envio.opcoes.body), {
      type: 'point',
      external_reference: JSON.parse(envio.opcoes.body).external_reference,
      expiration_time: 'PT16M',
      transactions: { payments: [{ amount: '67.89' }] },
      config: {
        point: { terminal_id: TERMINAL, print_on_terminal: 'no_ticket' },
        payment_method: { default_type: 'credit_card', default_installments: 3, installments_cost: 'seller' }
      },
      description: 'Kit freio'
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
    delete process.env.MERCADO_PAGO_TERMINAL_ID;
  }
});

test('status explica quando a Point está fora do modo PDV', async () => {
  const fetchOriginal = globalThis.fetch;
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'APP_USR_TESTE';
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { terminals: [{ id: TERMINAL, operating_mode: 'STANDALONE' }] }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const status = await statusPoint();
    assert.equal(status.disponivel, false);
    assert.match(status.motivo, /modo PDV/i);
  } finally {
    globalThis.fetch = fetchOriginal;
    delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
  }
});
