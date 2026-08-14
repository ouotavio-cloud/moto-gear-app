/**
 * Leitura de nota fiscal por IA.
 *
 * A chave da API fica só no servidor: se ela viajasse dentro do APK, qualquer
 * pessoa poderia extraí-la do arquivo e gastar a cota da oficina.
 */

import { erro } from './negocio.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELO_PADRAO = 'gemini-2.5-flash';

const PROMPT = `Você recebe a foto de uma nota fiscal, cupom fiscal ou recibo de compra de peças de moto.
Extraia os dados da compra. Regras:
- "itens" deve conter cada produto comprado, com o nome como está escrito na nota.
- "qtd" é a quantidade comprada (use 1 se não estiver claro).
- "valorUnitario" é o preço de custo por unidade, em reais, sem símbolo de moeda.
- "total" é o valor total da nota em reais.
- Se algum campo não estiver legível, use string vazia ou 0.
Responda apenas o JSON.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    fornecedor: { type: 'STRING' },
    cnpj: { type: 'STRING' },
    numero: { type: 'STRING' },
    data: { type: 'STRING' },
    total: { type: 'NUMBER' },
    itens: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' },
          qtd: { type: 'NUMBER' },
          valorUnitario: { type: 'NUMBER' }
        },
        required: ['nome', 'qtd', 'valorUnitario']
      }
    }
  },
  required: ['fornecedor', 'total', 'itens']
};

export const iaDisponivel = () => Boolean(process.env.GEMINI_API_KEY);

export async function lerNotaFiscal({ imagemBase64, mimeType = 'image/jpeg' }) {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw erro(503, 'Leitura por IA não está configurada no servidor (falta GEMINI_API_KEY).');
  if (!imagemBase64) throw erro(400, 'Envie a foto da nota.');

  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;
  const resposta = await fetch(`${ENDPOINT}/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(chave)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imagemBase64 } }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 }
    })
  });

  if (!resposta.ok) {
    const detalhe = await resposta.json().catch(() => null);
    throw erro(502, `A IA recusou a leitura: ${detalhe?.error?.message ?? `HTTP ${resposta.status}`}`);
  }

  const dados = await resposta.json();
  const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) throw erro(502, 'A IA não retornou dados legíveis desta foto.');

  let nota;
  try {
    nota = JSON.parse(texto);
  } catch {
    throw erro(502, 'A IA respondeu num formato inesperado.');
  }

  nota.itens = (nota.itens ?? [])
    .filter((i) => i?.nome)
    .map((i) => ({
      nome: String(i.nome).trim(),
      qtd: Math.max(1, Math.round(Number(i.qtd) || 1)),
      valorUnitario: Math.max(0, Number(i.valorUnitario) || 0)
    }));

  return nota;
}
