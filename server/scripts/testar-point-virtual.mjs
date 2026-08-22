/** Teste manual da Orders API com a Point virtual oficial do Mercado Pago. */

import { randomUUID } from 'node:crypto';

const token = String(process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN ?? '').trim();
if (!token) throw new Error('Cadastre o secret MERCADO_PAGO_TEST_ACCESS_TOKEN antes de executar.');

const base = 'https://api.mercadopago.com';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function chamar(caminho, opcoes = {}) {
  const resposta = await fetch(`${base}${caminho}`, { ...opcoes, headers: { ...headers, ...opcoes.headers } });
  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!resposta.ok) throw new Error(`Mercado Pago respondeu HTTP ${resposta.status}: ${texto}`);
  return dados;
}

console.log('1/3 Criando cobrança de R$ 1,00 na Point virtual SBX0000001...');
const ordem = await chamar('/v1/orders', {
  method: 'POST',
  headers: { 'X-Idempotency-Key': randomUUID() },
  body: JSON.stringify({
    type: 'point',
    external_reference: `motogear_teste_${Date.now()}`,
    expiration_time: 'PT16M',
    transactions: { payments: [{ amount: '1.00' }] },
    config: {
      point: { terminal_id: 'NEWLAND_N950__SBX0000001', print_on_terminal: 'no_ticket' },
      payment_method: { default_type: 'credit_card', default_installments: 1, installments_cost: 'seller' }
    },
    description: 'Teste técnico Moto Gear'
  })
});

if (!ordem?.id) throw new Error('A criação não retornou o ID da order.');
console.log(`2/3 Order ${ordem.id} criada. Simulando aprovação...`);
await chamar(`/v1/orders/${encodeURIComponent(ordem.id)}/events`, {
  method: 'POST',
  body: JSON.stringify({
    status: 'processed',
    payment_method_type: 'credit_card',
    installments: 1,
    payment_method_id: 'visa',
    status_detail: 'accredited'
  })
});

let resultado;
for (let tentativa = 1; tentativa <= 15; tentativa += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  resultado = await chamar(`/v1/orders/${encodeURIComponent(ordem.id)}`);
  console.log(`3/3 Consulta ${tentativa}: ${resultado.status}`);
  if (resultado.status === 'processed') break;
}

const pagamento = resultado?.transactions?.payments?.[0];
if (resultado?.status !== 'processed' || pagamento?.status !== 'processed') {
  throw new Error(`Teste não foi aprovado. Status final: ${resultado?.status || 'desconhecido'}.`);
}

console.log(`SUCESSO: Point virtual aprovou R$ ${pagamento.paid_amount || pagamento.amount} em ${pagamento.payment_method?.installments || 1}x.`);
console.log('Este teste não acessou o banco, o caixa ou o estoque do Moto Gear.');
