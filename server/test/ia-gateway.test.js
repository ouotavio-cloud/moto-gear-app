import test from 'node:test';
import assert from 'node:assert/strict';
import { lerNotaFiscal, limparCircuitosIA } from '../src/ia.js';
import { normalizarRascunho } from '../src/assistente.js';

test('nota troca automaticamente do Gemini para Cloudflare em erro 429', async () => {
  const fetchOriginal = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'teste-gemini';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'conta-teste';
  process.env.CLOUDFLARE_API_TOKEN = 'teste-cloudflare';
  limparCircuitosIA();
  const chamadas = [];

  globalThis.fetch = async (url) => {
    chamadas.push(String(url));
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ error: { message: 'quota excedida' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'retry-after': '60' }
      });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        fornecedor: 'Moto Peças', cnpj: '', numero: '42', data: '21/08/2026', total: 50,
        itens: [{ nome: 'Filtro', qtd: 2, valorUnitario: 25 }]
      }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const nota = await lerNotaFiscal({ imagemBase64: 'YWJj', mimeType: 'image/jpeg' });
    assert.equal(nota.fornecedor, 'Moto Peças');
    assert.equal(nota.itens[0].qtd, 2);
    assert.deepEqual(nota._ia, { provedor: 'cloudflare', fallback: true });
    assert.equal(chamadas.length, 2);
  } finally {
    globalThis.fetch = fetchOriginal;
    delete process.env.GEMINI_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    limparCircuitosIA();
  }
});

test('rascunho mantém somente tipos e campos autorizados', () => {
  assert.deepEqual(normalizarRascunho({
    tipo: 'servico',
    dados: { nome: 'Troca de óleo', valor: 45, salvarSemConfirmar: true }
  }), { tipo: 'servico', dados: { nome: 'Troca de óleo', valor: 45 } });
  assert.equal(normalizarRascunho({ tipo: 'apagar_tudo', dados: { confirmar: true } }), null);
});
