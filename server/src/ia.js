/** Gateway de IA: notas fiscais, ajudante e voz com fallback automático. */

import { erro } from './negocio.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const circuitos = new Map();

const PROMPT_NOTA = `Você recebe a foto de uma nota fiscal, cupom fiscal ou recibo de compra de peças de moto.
Extraia os dados da compra. Regras:
- "itens" deve conter cada produto comprado, com o nome como está escrito na nota.
- "qtd" é a quantidade comprada (use 1 se não estiver claro).
- "valorUnitario" é o preço de custo por unidade, em reais, sem símbolo de moeda.
- "total" é o valor total da nota em reais.
- Se algum campo não estiver legível, use string vazia ou 0.
Responda apenas o JSON.`;

const SCHEMA_NOTA = {
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

function configurado(provedor) {
  if (provedor === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
  if (provedor === 'groq') return Boolean(process.env.GROQ_API_KEY);
  if (provedor === 'cloudflare') return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
  return false;
}

export function statusIA() {
  return {
    disponivel: ['gemini', 'groq', 'cloudflare'].some(configurado),
    notas: { gemini: configurado('gemini'), cloudflare: configurado('cloudflare') },
    ajudante: { groq: configurado('groq'), cloudflare: configurado('cloudflare') },
    voz: { groq: configurado('groq') }
  };
}

export const iaDisponivel = () => statusIA().disponivel;

function falhaProvedor(provedor, resposta, detalhe) {
  const status = resposta?.status ?? 502;
  const retryAfter = Number(resposta?.headers?.get?.('retry-after')) || 0;
  const e = new Error(detalhe || `${provedor} respondeu HTTP ${status}`);
  e.provedor = provedor;
  e.statusProvedor = status;
  e.retryable = status === 408 || status === 429 || status >= 500;
  e.retryAfter = retryAfter;
  return e;
}

async function fetchComTimeout(url, opcoes, provedor) {
  const timeout = Math.max(5_000, Number(process.env.IA_TIMEOUT_MS) || 35_000);
  try {
    return await fetch(url, { ...opcoes, signal: AbortSignal.timeout(timeout) });
  } catch (cause) {
    const e = falhaProvedor(provedor, null, `${provedor} não respondeu a tempo.`);
    e.retryable = true;
    e.cause = cause;
    throw e;
  }
}

function circuitoAberto(chave) {
  return (circuitos.get(chave) ?? 0) > Date.now();
}

function abrirCircuito(chave, falha) {
  const segundos = falha.statusProvedor === 429 ? Math.max(60, falha.retryAfter) : 20;
  circuitos.set(chave, Date.now() + segundos * 1000);
}

export function limparCircuitosIA() {
  circuitos.clear();
}

export async function executarComFallback(tarefa, provedores) {
  const candidatos = provedores.filter(({ nome }) => configurado(nome));
  if (!candidatos.length) throw erro(503, `IA para ${tarefa} ainda não está configurada no servidor.`);

  const falhas = [];
  for (const candidato of candidatos) {
    const chave = `${tarefa}:${candidato.nome}`;
    if (circuitoAberto(chave)) continue;
    try {
      const resultado = await candidato.executar();
      circuitos.delete(chave);
      return { resultado, provedor: candidato.nome, fallback: falhas.length > 0 };
    } catch (falha) {
      falhas.push(falha);
      if (!falha.retryable) throw erro(422, falha.message);
      abrirCircuito(chave, falha);
      console.warn(`[IA] ${tarefa}: ${candidato.nome} indisponível; tentando fallback.`, falha.message);
    }
  }

  throw erro(503, 'Os serviços de IA estão ocupados agora. Aguarde um instante e tente novamente.');
}

export function extrairTextoJSON(texto) {
  const limpo = String(texto ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio < 0 || fim < inicio) throw falhaProvedor('modelo', null, 'A IA respondeu num formato inesperado.');
  try {
    return JSON.parse(limpo.slice(inicio, fim + 1));
  } catch {
    throw falhaProvedor('modelo', null, 'A IA respondeu num formato inesperado.');
  }
}

function normalizarNota(nota) {
  return {
    fornecedor: String(nota?.fornecedor ?? '').trim(),
    cnpj: String(nota?.cnpj ?? '').trim(),
    numero: String(nota?.numero ?? '').trim(),
    data: String(nota?.data ?? '').trim(),
    total: Math.max(0, Number(nota?.total) || 0),
    itens: (Array.isArray(nota?.itens) ? nota.itens : [])
      .filter((item) => item?.nome)
      .map((item) => ({
        nome: String(item.nome).trim(),
        qtd: Math.max(1, Math.round(Number(item.qtd) || 1)),
        valorUnitario: Math.max(0, Number(item.valorUnitario) || 0)
      }))
  };
}

async function geminiNota(imagemBase64, mimeType) {
  const modelo = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const resposta = await fetchComTimeout(
    `${GEMINI_ENDPOINT}/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT_NOTA }, { inline_data: { mime_type: mimeType, data: imagemBase64 } }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA_NOTA, temperature: 0, maxOutputTokens: 2_000 }
      })
    },
    'gemini'
  );
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw falhaProvedor('gemini', resposta, dados?.error?.message);
  const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) throw falhaProvedor('gemini', null, 'O Gemini não encontrou dados legíveis nesta foto.');
  return normalizarNota(extrairTextoJSON(texto));
}

function endpointCloudflare() {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/v1/chat/completions`;
}

export async function cloudflareChat(messages, { modelo, maxTokens = 1_000, temperatura = 0 } = {}) {
  const resposta = await fetchComTimeout(
    endpointCloudflare(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      body: JSON.stringify({
        model: modelo || process.env.CLOUDFLARE_CHAT_MODEL || '@cf/qwen/qwen3.8-27b',
        messages,
        temperature: temperatura,
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_object' }
      })
    },
    'cloudflare'
  );
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw falhaProvedor('cloudflare', resposta, dados?.errors?.[0]?.message || dados?.error?.message);
  const texto = dados?.choices?.[0]?.message?.content ?? dados?.result?.response;
  if (!texto) throw falhaProvedor('cloudflare', null, 'O modelo alternativo não retornou uma resposta.');
  return extrairTextoJSON(texto);
}

async function cloudflareNota(imagemBase64, mimeType) {
  return normalizarNota(await cloudflareChat([{
    role: 'user',
    content: [
      { type: 'text', text: PROMPT_NOTA },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imagemBase64}` } }
    ]
  }], { modelo: process.env.CLOUDFLARE_VISION_MODEL || '@cf/qwen/qwen3.8-27b', maxTokens: 2_000 }));
}

export async function lerNotaFiscal({ imagemBase64, mimeType = 'image/jpeg' }) {
  if (!imagemBase64) throw erro(400, 'Envie a foto da nota.');
  const { resultado, provedor, fallback } = await executarComFallback('leitura de notas', [
    { nome: 'gemini', executar: () => geminiNota(imagemBase64, mimeType) },
    { nome: 'cloudflare', executar: () => cloudflareNota(imagemBase64, mimeType) }
  ]);
  return { ...resultado, _ia: { provedor, fallback } };
}

export { falhaProvedor, fetchComTimeout };
