/** Copiloto do Moto Gear: ajuda contextual, rascunhos e transcrição de voz. */

import { erro, estadoCompleto } from './negocio.js';
import { cloudflareChat, executarComFallback, extrairTextoJSON, falhaProvedor, fetchComTimeout } from './ia.js';

const MANUAL = {
  geral: `O Moto Gear organiza uma oficina de motos. A barra inferior contém Início, Operações, Caixa e Clientes.
Recursos menos frequentes ficam na foto de perfil: estoque, serviços, fornecedores, análises e configurações.
O ajudante nunca salva sozinho: ele prepara um rascunho para a pessoa revisar e confirmar.`,
  inicio: `Início mostra saldo, itens em estoque, OS abertas, alertas de estoque baixo e últimas transações.`,
  operacoes: `Operações reúne Produtos e estoque, Serviços e Fornecedores.`,
  estoque: `Em Produtos e estoque é possível buscar peças, ler código de barras, cadastrar produto e ajustar quantidade. Produto possui nome, código, categoria, marca, custo, venda, quantidade e mínimo.`,
  servicos: `Serviços guarda nome, valor da mão de obra e peças vinculadas. Para cadastrar, toque em Novo serviço, confira os campos e salve.`,
  caixa: `Caixa registra venda ou despesa. Na venda, adicione peças ou serviços, confira o total e escolha Dinheiro, Cartão ou PIX. Despesas precisam de descrição e valor.`,
  clientes: `Clientes guarda nome, telefone, placa e moto. No perfil ficam OS, orçamentos, histórico e pendências.`,
  fornecedores: `Fornecedores guarda nome, CNPJ, telefone, vendedor e observações.`,
  analises: `Análises apresenta receitas, despesas, resultados, produtos e serviços mais vendidos e visão mensal.`,
  configuracoes: `Configurações contém servidor, Pix, usuários, convite, backup, restauração, importação e troca de senha.`
};

const TIPOS_RASCUNHO = new Set(['produto', 'servico', 'cliente', 'fornecedor', 'despesa', 'venda']);

function contextoDaTela(tela) {
  const id = String(tela ?? '').replace(/^tab-/, '').toLowerCase();
  return `${MANUAL.geral}\n\nTela atual (${id || 'geral'}): ${MANUAL[id] || MANUAL.geral}`;
}

function promptSistema(tela) {
  return `Você é o Ajudante Moto Gear, copiloto de uma oficina de motos.
Responda em português do Brasil, de forma curta, prática e amigável.
Use somente o manual fornecido. Se não souber, diga que não encontrou essa informação no Moto Gear.

Quando o usuário pedir para cadastrar ou registrar algo, prepare um rascunho. Tipos e campos permitidos:
- produto: nome, codigoBarras, categoria, marca, custo, venda, qtd, min
- servico: nome, valor
- cliente: nome, tel, placa, moto
- fornecedor: nome, cnpj, tel, vendedor, obs
- despesa: desc, valor

Nunca afirme que salvou. Diga que preparou os campos para revisão.
Responda exclusivamente em JSON válido neste formato:
{"resposta":"texto","sugestoes":["sugestão curta"],"rascunho":null}
ou
{"resposta":"texto","sugestoes":[],"rascunho":{"tipo":"servico","dados":{"nome":"Troca de óleo","valor":45}}}

Manual:
${contextoDaTela(tela)}`;
}

function normalizarRascunho(valor) {
  if (!valor || !TIPOS_RASCUNHO.has(valor.tipo) || typeof valor.dados !== 'object') return null;
  if (valor.tipo === 'venda') {
    const itens = (Array.isArray(valor.dados.itens) ? valor.dados.itens : [])
      .filter((item) => ['produto', 'servico'].includes(item?.tipo) && item?.itemId)
      .map((item) => ({
        tipo: item.tipo,
        itemId: String(item.itemId),
        nome: String(item.nome ?? '').slice(0, 160),
        qtd: Math.max(1, Math.min(999, Math.trunc(Number(item.qtd) || 1))),
        valorUnitario: Number(item.valorUnitario) || 0,
        total: Number(item.total) || 0
      }));
    return itens.length ? { tipo: 'venda', dados: { itens, total: Number(valor.dados.total) || 0 } } : null;
  }
  const permitidos = {
    produto: ['nome', 'codigoBarras', 'categoria', 'marca', 'custo', 'venda', 'qtd', 'min'],
    servico: ['nome', 'valor'],
    cliente: ['nome', 'tel', 'placa', 'moto'],
    fornecedor: ['nome', 'cnpj', 'tel', 'vendedor', 'obs'],
    despesa: ['desc', 'valor']
  }[valor.tipo];
  const dados = {};
  for (const campo of permitidos) {
    if (valor.dados[campo] !== undefined && valor.dados[campo] !== null) dados[campo] = valor.dados[campo];
  }
  return Object.keys(dados).length ? { tipo: valor.tipo, dados } : null;
}

function semAcentos(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const NUMEROS_FALADOS = new Map(Object.entries({
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezassete: 17,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20
}));

const PALAVRAS_NUMERO = [...NUMEROS_FALADOS.keys()].join('|');

function numeroFalado(texto) {
  const isolado = texto.match(new RegExp(`^(${PALAVRAS_NUMERO})(?: unidades?)?$`));
  const comUnidade = texto.match(new RegExp(`\\b(${PALAVRAS_NUMERO})\\s+unidades?\\b`));
  const nomeado = texto.match(new RegExp(`\\b(?:qtd|quantidade)\\s*(?:de)?\\s*(${PALAVRAS_NUMERO})\\b`));
  const aposVenda = texto.match(new RegExp(`^(?:quero\\s+)?(?:registrar|registre|fazer|realizar)?\\s*(?:uma\\s+)?(?:venda|vender|vendi)\\s+(${PALAVRAS_NUMERO})\\b`));
  return NUMEROS_FALADOS.get(isolado?.[1] || comUnidade?.[1] || nomeado?.[1] || aposVenda?.[1]) || null;
}

function quantidadeDaMensagem(mensagem) {
  const texto = semAcentos(mensagem);
  const isolada = texto.match(/^(\d{1,3})(?: unidades?)?$/);
  const comUnidade = texto.match(/\b(\d{1,3})\s*(?:x|unidades?)\b/);
  const nomeada = texto.match(/\b(?:qtd|quantidade)\s*(?:de)?\s*(\d{1,3})\b/);
  const aposVenda = texto.match(/^(?:quero\s+)?(?:registrar|registre|fazer|realizar)?\s*(?:uma\s+)?(?:venda|vender|vendi)\s+(\d{1,3})\b/);
  const valor = Number(isolada?.[1] || comUnidade?.[1] || nomeada?.[1] || aposVenda?.[1] || 0);
  return valor > 0 ? Math.min(valor, 999) : numeroFalado(texto);
}

function buscaDaMensagem(mensagem) {
  return semAcentos(mensagem)
    .replace(/^(?:quero\s+)?(?:registrar|registre|fazer|realizar)?\s*(?:uma\s+)?(?:venda|vender|vendi)\s*/, '')
    .replace(/^\d{1,3}\s*(?:x|unidades?)?\s*/, '')
    .replace(new RegExp(`^(${PALAVRAS_NUMERO})\\s*(?:unidades?)?\\s*`), '')
    .replace(/\b(?:qtd|quantidade)\s*(?:de)?\s*\d{1,3}\b/g, '')
    .replace(new RegExp(`\\b(?:qtd|quantidade)\\s*(?:de)?\\s*(${PALAVRAS_NUMERO})\\b`, 'g'), '')
    .replace(/\b\d{1,3}\s*(?:x|unidades?)\b/g, '')
    .replace(new RegExp(`\\b(${PALAVRAS_NUMERO})\\s+unidades?\\b`, 'g'), '')
    .trim();
}

function pontuar(nome, busca) {
  const alvo = semAcentos(nome);
  if (!busca) return 0;
  if (alvo === busca) return 1_000;
  if (alvo.startsWith(busca) || alvo.includes(busca)) return 800 - Math.abs(alvo.length - busca.length);
  if (busca.includes(alvo)) return 700 - Math.abs(alvo.length - busca.length);
  const ignorados = new Set(['a', 'as', 'de', 'do', 'da', 'dos', 'das', 'o', 'os', 'para', 'pra', 'por', 'favor', 'unidade', 'unidades']);
  const termos = busca.split(' ').filter((termo) => termo && !ignorados.has(termo));
  const encontrados = termos.filter((termo) => alvo.includes(termo)).length;
  return encontrados ? (encontrados / termos.length) * 500 : 0;
}

function catalogoVenda(estado) {
  const produtos = estado.produtos.map((produto) => ({
    tipo: 'produto', itemId: produto.id, nome: produto.nome, valor: Number(produto.venda), estoque: Number(produto.qtd)
  }));
  const servicos = estado.servicos.map((servico) => {
    const pecas = (Array.isArray(servico.pecas) ? servico.pecas : []).reduce((total, peca) => {
      const produto = estado.produtos.find((item) => item.id === peca.produtoId);
      return total + (produto ? Number(produto.venda) * Number(peca.qtd || 1) : 0);
    }, 0);
    const vinculadas = Array.isArray(servico.pecas) ? servico.pecas : [];
    const porProduto = vinculadas.reduce((soma, peca) => {
      const produtoId = String(peca.produtoId ?? '');
      if (produtoId) soma.set(produtoId, (soma.get(produtoId) || 0) + Math.max(1, Number(peca.qtd) || 1));
      return soma;
    }, new Map());
    const limite = porProduto.size
      ? Math.min(...[...porProduto].map(([produtoId, quantidade]) => {
        const produto = estado.produtos.find((item) => item.id === produtoId);
        return produto ? Math.floor(Number(produto.qtd) / quantidade) : 0;
      }))
      : null;
    return { tipo: 'servico', itemId: servico.id, nome: servico.nome, valor: Number(servico.valor) + pecas, estoque: limite };
  });
  return [...produtos, ...servicos];
}

function estadoVenda(item, fase, quantidade = null) {
  return { fase, item: item ? { tipo: item.tipo, itemId: item.itemId, nome: item.nome, valor: item.valor, estoque: item.estoque } : null, quantidade };
}

export async function prepararVenda({ mensagem, vendaAtual }, organizacaoId) {
  const texto = String(mensagem ?? '').trim();
  if (!texto) throw erro(400, 'Fale qual produto ou serviço deseja vender.');
  if (/^(cancelar|cancela|desistir|desisti)(?:\s+(?:a\s+)?venda)?[.!]?$/i.test(texto)) {
    return { resposta: 'Tudo bem, cancelei o rascunho da venda.', sugestoes: ['Registrar uma venda'], venda: null, rascunho: null };
  }
  const catalogo = catalogoVenda(await estadoCompleto(organizacaoId));
  const atualId = String(vendaAtual?.item?.itemId ?? '');
  let item = atualId ? catalogo.find((opcao) => opcao.itemId === atualId) : null;
  const quantidade = quantidadeDaMensagem(texto) || Number(vendaAtual?.quantidade) || null;

  if (!item) {
    const busca = buscaDaMensagem(texto);
    if (!busca) {
      return {
        resposta: 'Qual produto ou serviço você quer vender?',
        sugestoes: catalogo.slice(0, 3).map((opcao) => opcao.nome),
        venda: estadoVenda(null, 'aguardando_item'),
        rascunho: null
      };
    }
    const candidatos = catalogo.map((opcao) => ({ ...opcao, pontos: pontuar(opcao.nome, busca) }))
      .filter((opcao) => opcao.pontos >= 300).sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));
    if (!candidatos.length) {
      return { resposta: `Não encontrei “${texto}” nos produtos ou serviços ativos.`, sugestoes: [], venda: estadoVenda(null, 'aguardando_item'), rascunho: null };
    }
    if (candidatos.length > 1 && candidatos[0].pontos < 1_000 && candidatos[0].pontos - candidatos[1].pontos < 80) {
      return {
        resposta: 'Encontrei mais de uma opção. Qual delas você quis dizer?',
        sugestoes: candidatos.slice(0, 3).map((opcao) => opcao.nome),
        venda: estadoVenda(null, 'aguardando_item'),
        rascunho: null
      };
    }
    item = candidatos[0];
  }

  if (!quantidade) {
    const limite = item.estoque === null ? 3 : Math.min(3, Math.max(0, item.estoque));
    return {
      resposta: `Encontrei ${item.nome}. Quantas unidades foram vendidas?`,
      sugestoes: Array.from({ length: limite }, (_, indice) => `${indice + 1} ${indice ? 'unidades' : 'unidade'}`),
      venda: estadoVenda(item, 'aguardando_quantidade'),
      rascunho: null
    };
  }

  if (item.estoque !== null && item.estoque < quantidade) {
    return {
      resposta: item.tipo === 'produto'
        ? `O estoque de ${item.nome} tem ${item.estoque} unidade(s), menos que as ${quantidade} solicitadas.`
        : `Não há peças suficientes para realizar ${quantidade} unidade(s) de ${item.nome}. É possível realizar ${item.estoque}.`,
      sugestoes: item.estoque > 0 ? [`${item.estoque} ${item.estoque === 1 ? 'unidade' : 'unidades'}`] : [],
      venda: estadoVenda(item, 'aguardando_quantidade'),
      rascunho: null
    };
  }

  const total = Math.round(item.valor * quantidade * 100) / 100;
  return {
    resposta: `Preparei ${quantidade}x ${item.nome}, total de R$ ${total.toFixed(2).replace('.', ',')}. Revise antes de receber o pagamento.`,
    sugestoes: [],
    venda: estadoVenda(item, 'pronta', quantidade),
    rascunho: normalizarRascunho({
      tipo: 'venda',
      dados: { itens: [{ tipo: item.tipo, itemId: item.itemId, nome: item.nome, qtd: quantidade, valorUnitario: item.valor, total }], total }
    })
  };
}

function normalizarResposta(valor, provedor) {
  return {
    resposta: String(valor?.resposta ?? '').trim() || 'Não consegui formular uma resposta agora.',
    sugestoes: (Array.isArray(valor?.sugestoes) ? valor.sugestoes : []).slice(0, 3).map((item) => String(item).trim()).filter(Boolean),
    rascunho: normalizarRascunho(valor?.rascunho),
    _ia: { provedor }
  };
}

function respostaLocal(mensagem, tela) {
  const texto = String(mensagem ?? '').toLowerCase();
  const regras = [
    [/pix/, 'No Caixa, abra Nova venda, adicione os itens e escolha PIX. A opção aparece quando a chave da oficina está configurada.'],
    [/fornecedor/, MANUAL.fornecedores],
    [/servi[cç]o/, MANUAL.servicos],
    [/estoque|produto|pe[cç]a/, MANUAL.estoque],
    [/cliente/, MANUAL.clientes],
    [/venda|dinheiro|cart[aã]o/, MANUAL.caixa],
    [/ordem|\bos\b|or[cç]amento/, MANUAL.clientes],
    [/backup/, MANUAL.configuracoes]
  ];
  const encontrada = regras.find(([padrao]) => padrao.test(texto));
  return {
    resposta: encontrada?.[1] || MANUAL[String(tela ?? '').replace(/^tab-/, '')] || MANUAL.geral,
    sugestoes: ['Como faço uma venda no PIX?', 'Quero cadastrar um serviço'],
    rascunho: null,
    _ia: { provedor: 'ajuda-local' }
  };
}

async function groqConversa(messages) {
  const resposta = await fetchComTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b',
      messages,
      temperature: 0.2,
      max_completion_tokens: 700,
      response_format: { type: 'json_object' }
    })
  }, 'groq');
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw falhaProvedor('groq', resposta, dados?.error?.message);
  const texto = dados?.choices?.[0]?.message?.content;
  if (!texto) throw falhaProvedor('groq', null, 'O ajudante não retornou uma resposta.');
  return extrairTextoJSON(texto);
}

async function geminiConversa(messages) {
  const modelo = process.env.GEMINI_ASSISTANT_MODEL || 'gemini-2.5-flash-lite';
  const resposta = await fetchComTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.filter((m) => m.role !== 'system').map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        systemInstruction: { parts: [{ text: messages.find((m) => m.role === 'system')?.content || '' }] },
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 700 }
      })
    },
    'gemini'
  );
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw falhaProvedor('gemini', resposta, dados?.error?.message);
  return extrairTextoJSON(dados?.candidates?.[0]?.content?.parts?.[0]?.text);
}

export async function conversar({ mensagem, tela, historico = [] }) {
  const pergunta = String(mensagem ?? '').trim();
  if (!pergunta) throw erro(400, 'Escreva ou fale uma mensagem para o ajudante.');
  if (pergunta.length > 1_500) throw erro(400, 'Mensagem muito longa. Resuma o pedido em até 1.500 caracteres.');

  const anteriores = (Array.isArray(historico) ? historico : []).slice(-6)
    .filter((item) => ['user', 'assistant'].includes(item?.role) && item?.content)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 1_500) }));
  const messages = [{ role: 'system', content: promptSistema(tela) }, ...anteriores, { role: 'user', content: pergunta }];

  const provedores = [
    { nome: 'groq', executar: () => groqConversa(messages) },
    { nome: 'cloudflare', executar: () => cloudflareChat(messages, { maxTokens: 700, temperatura: 0.2 }) }
  ];
  if (process.env.ASSISTANT_GEMINI_FALLBACK === 'true') provedores.push({ nome: 'gemini', executar: () => geminiConversa(messages) });

  try {
    const { resultado, provedor, fallback } = await executarComFallback('ajudante', provedores);
    return { ...normalizarResposta(resultado, provedor), _ia: { provedor, fallback } };
  } catch (falha) {
    if (falha.status === 503) return respostaLocal(pergunta, tela);
    throw falha;
  }
}

export async function transcrever({ audioBase64, mimeType = 'audio/webm' }) {
  if (!process.env.GROQ_API_KEY) throw erro(503, 'A transcrição por voz ainda não está configurada.');
  if (!audioBase64) throw erro(400, 'Grave uma mensagem de voz primeiro.');
  const bytes = Buffer.from(audioBase64, 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw erro(413, 'O áudio deve ter no máximo 8 MB.');

  const extensao = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
  const formulario = new FormData();
  formulario.append('file', new Blob([bytes], { type: mimeType }), `comando.${extensao}`);
  formulario.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
  formulario.append('language', 'pt');
  formulario.append('response_format', 'json');

  const resposta = await fetchComTimeout('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: formulario
  }, 'groq');
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw erro(503, dados?.error?.message || 'Não consegui transcrever o áudio agora.');
  const texto = String(dados?.text ?? '').trim();
  if (!texto) throw erro(422, 'Não consegui entender o áudio. Tente falar mais perto do microfone.');
  return { texto, _ia: { provedor: 'groq', modelo: process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo' } };
}

export { MANUAL, normalizarRascunho, respostaLocal };
