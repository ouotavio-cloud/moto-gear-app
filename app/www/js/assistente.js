/** Ajudante contextual: conversa, voz e preenchimento seguro de rascunhos. */

import { req } from './api.js';
import { plugin } from './files.js';
import { abrirModal, fecharModal, el, esc, setVal, showToast, atualizarIcones } from './ui.js';

let historico = [];
let rascunhoAtual = null;
let gravador = null;
let iniciandoGravacao = false;
let pedacosAudio = [];
let fluxoAudio = null;
let vendaEmPreparacao = null;
let geracaoAssistente = 0;
let geracaoVoz = 0;
let sequenciaMensagens = 0;
const mensagensFaladas = new Map();
const CHAVE_RESPOSTAS_VOZ = 'motogear_respostas_voz';

export function respostasPorVozAtivas() {
  try {
    return localStorage.getItem(CHAVE_RESPOSTAS_VOZ) !== 'nao';
  } catch {
    return true;
  }
}

export function pararRespostaFalando() {
  geracaoVoz += 1;
  const nativo = plugin('MotoGearNative');
  nativo?.stopSpeaking?.().catch?.(() => {});
  globalThis.speechSynthesis?.cancel?.();
}

export function definirRespostasPorVoz(ativas) {
  try {
    localStorage.setItem(CHAVE_RESPOSTAS_VOZ, ativas ? 'sim' : 'nao');
  } catch (err) {
    console.error('Não consegui salvar a preferência de voz', err);
  }
  if (!ativas) pararRespostaFalando();
}

function vozPortugues() {
  const vozes = globalThis.speechSynthesis?.getVoices?.() || [];
  return vozes.find((voz) => /^pt-BR$/i.test(voz.lang)) || vozes.find((voz) => /^pt\b/i.test(voz.lang)) || null;
}

async function falarTexto(texto, { forcar = false } = {}) {
  const conteudo = String(texto ?? '').trim();
  if (!conteudo || !podeFalarAutomaticamente() || (!forcar && !respostasPorVozAtivas())) return false;
  pararRespostaFalando();
  const geracao = geracaoVoz;

  const nativo = plugin('MotoGearNative');
  if (nativo?.speak) {
    try {
      await nativo.speak({ text: conteudo, language: 'pt-BR', rate: 1 });
      return true;
    } catch (err) {
      console.error('Voz nativa indisponível, usando voz do navegador', err);
    }
  }

  if (geracao !== geracaoVoz || !podeFalarAutomaticamente()) return false;
  if (!forcar && (!respostasPorVozAtivas() || !podeFalarAutomaticamente())) return false;
  if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return false;
  try {
    const fala = new globalThis.SpeechSynthesisUtterance(conteudo);
    fala.lang = 'pt-BR';
    fala.rate = 1;
    fala.pitch = 1;
    fala.voice = vozPortugues();
    globalThis.speechSynthesis.speak(fala);
    return true;
  } catch (err) {
    console.error('Voz do navegador indisponível', err);
    return false;
  }
}

export async function ouvirResposta(id) {
  const texto = mensagensFaladas.get(String(id));
  if (!texto) return;
  if (!await falarTexto(texto, { forcar: true })) showToast('A voz não está disponível neste aparelho.');
}

export function resetarAssistente() {
  geracaoAssistente += 1;
  historico = [];
  rascunhoAtual = null;
  vendaEmPreparacao = null;
  sequenciaMensagens = 0;
  mensagensFaladas.clear();
  pararRespostaFalando();
  pedacosAudio = [];
  if (gravador?.state === 'recording') {
    gravador.ondataavailable = null;
    gravador.onstop = null;
    gravador.stop();
  }
  gravador = null;
  encerrarFluxoAudio();
  const mensagens = el('assistente-mensagens');
  const sugestoes = el('assistente-sugestoes');
  const rascunho = el('assistente-rascunho');
  if (mensagens) mensagens.innerHTML = '';
  if (sugestoes) sugestoes.innerHTML = '';
  if (rascunho) {
    rascunho.innerHTML = '';
    rascunho.classList.add('hidden');
  }
  setOcupado(false);
}

function telaAtual() {
  return document.querySelector('.tab-content.active')?.id || 'tab-inicio';
}

function adicionarMensagem(role, content) {
  const texto = String(content);
  historico.push({ role, content: texto });
  historico = historico.slice(-12);
  const lista = el('assistente-mensagens');
  const classe = role === 'user' ? 'assistant-message-user' : 'assistant-message-ai';
  const id = role === 'assistant' ? `fala-${++sequenciaMensagens}` : '';
  if (id) mensagensFaladas.set(id, texto);
  lista.insertAdjacentHTML('beforeend', `
    <div class="assistant-message ${classe}">
      <span>${esc(texto)}</span>
      ${id ? `<button type="button" class="assistant-replay" onclick="App.ouvirRespostaIA('${id}')" aria-label="Ouvir esta resposta"><i data-lucide="volume-2" aria-hidden="true"></i></button>` : ''}
    </div>`);
  lista.scrollTop = lista.scrollHeight;
  atualizarIcones();
}

function renderSugestoes(sugestoes = []) {
  const area = el('assistente-sugestoes');
  area.innerHTML = sugestoes.map((texto) =>
    `<button type="button" class="assistant-chip" data-sugestao="${esc(texto)}" onclick="App.usarSugestaoIA(this.dataset.sugestao)">${esc(texto)}</button>`
  ).join('');
}

function rotuloRascunho(tipo) {
  return ({ produto: 'Produto', servico: 'Serviço', cliente: 'Cliente', fornecedor: 'Fornecedor', despesa: 'Despesa', venda: 'Venda' })[tipo] || 'Cadastro';
}

function renderRascunho(rascunho) {
  rascunhoAtual = rascunho || null;
  const area = el('assistente-rascunho');
  area.classList.remove('assistant-draft-complete');
  if (!rascunhoAtual) {
    area.classList.add('hidden');
    area.innerHTML = '';
    return;
  }
  const venda = rascunhoAtual.tipo === 'venda';
  const linhas = venda
    ? (rascunhoAtual.dados.itens || []).map((item) => `<div><span>${esc(item.qtd)}x ${esc(item.nome)}</span><strong>${Number(item.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>`).join('')
      + `<div><span>Total</span><strong>${Number(rascunhoAtual.dados.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>`
    : Object.entries(rascunhoAtual.dados || {})
      .map(([campo, valor]) => `<div><span>${esc(campo)}</span><strong>${esc(valor)}</strong></div>`)
      .join('');
  area.innerHTML = `
    <p class="eyebrow">Rascunho de ${esc(rotuloRascunho(rascunhoAtual.tipo))}</p>
    <div class="assistant-draft-fields">${linhas}</div>
    <button type="button" class="btn-primary mt-3" onclick="App.aplicarRascunhoIA()"><i data-lucide="${venda ? 'shopping-cart' : 'wand-sparkles'}"></i> ${venda ? 'Revisar venda e receber' : 'Revisar no formulário'}</button>`;
  area.classList.remove('hidden');
  atualizarIcones();
}

function setOcupado(ocupado, texto = 'Pensando...') {
  el('assistente-enviar').disabled = ocupado;
  el('assistente-input').disabled = ocupado;
  el('assistente-status').textContent = ocupado ? texto : '';
  el('assistente-status').classList.toggle('hidden', !ocupado);
}

function podeFalarAutomaticamente() {
  return el('modal-assistente')?.classList.contains('active') && !iniciandoGravacao && gravador?.state !== 'recording';
}

export function abrirAssistente() {
  abrirModal('modal-assistente');
  if (!historico.length) {
    adicionarMensagem('assistant', 'Oi! Posso registrar uma venda por voz, explicar o Moto Gear ou preparar um cadastro para você revisar.');
    renderSugestoes(['Registrar uma venda', 'Quero cadastrar um serviço', 'Como funciona o estoque mínimo?']);
  }
  setTimeout(() => el('assistente-input')?.focus(), 80);
}

export function fecharAssistente() {
  if (gravador?.state === 'recording') gravador.stop();
  pararRespostaFalando();
  fecharModal('modal-assistente');
}

export function usarSugestao(texto) {
  setVal('assistente-input', texto);
  enviarMensagem();
}

function iniciaFluxoVenda(mensagem) {
  if (vendaEmPreparacao) return true;
  return /^\s*(?:quero\s+)?(?:(?:registrar|registre|fazer|realizar)\s+)?(?:uma\s+)?(?:venda|vender|vendi)\b/i.test(mensagem);
}

export async function enviarMensagem(textoForcado) {
  const campo = el('assistente-input');
  const mensagem = String(textoForcado ?? campo.value).trim();
  if (!mensagem || campo.disabled) return;
  pararRespostaFalando();
  campo.value = '';
  renderSugestoes([]);
  renderRascunho(null);
  const anteriores = historico.slice(-6);
  const geracao = geracaoAssistente;
  adicionarMensagem('user', mensagem);
  setOcupado(true);
  try {
    const venda = iniciaFluxoVenda(mensagem);
    const resposta = venda
      ? await req('POST', '/assistente/venda', { mensagem, vendaAtual: vendaEmPreparacao })
      : await req('POST', '/assistente/conversar', { mensagem, tela: telaAtual(), historico: anteriores });
    if (geracao !== geracaoAssistente) return;
    vendaEmPreparacao = venda ? resposta.venda : null;
    adicionarMensagem('assistant', resposta.resposta);
    if (podeFalarAutomaticamente()) falarTexto(resposta.resposta);
    renderSugestoes(resposta.sugestoes);
    renderRascunho(resposta.rascunho);
  } catch (err) {
    if (geracao !== geracaoAssistente) return;
    const mensagemErro = err.message || 'Não consegui responder agora.';
    adicionarMensagem('assistant', mensagemErro);
    if (podeFalarAutomaticamente()) falarTexto(mensagemErro);
  } finally {
    if (geracao === geracaoAssistente) {
      setOcupado(false);
      campo.focus();
    }
  }
}

function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] || '');
    leitor.onerror = reject;
    leitor.readAsDataURL(blob);
  });
}

async function transcreverBlob(blob) {
  const geracao = geracaoAssistente;
  setOcupado(true, 'Transcrevendo áudio...');
  try {
    const audioBase64 = await blobBase64(blob);
    const resposta = await req('POST', '/assistente/transcrever', { audioBase64, mimeType: blob.type || 'audio/webm' });
    if (geracao !== geracaoAssistente) return;
    setVal('assistente-input', resposta.texto);
    setOcupado(false);
    await enviarMensagem(resposta.texto);
  } catch (err) {
    if (geracao !== geracaoAssistente) return;
    showToast(err.message || 'Não consegui entender o áudio.');
  } finally {
    if (geracao === geracaoAssistente) setOcupado(false);
  }
}

function encerrarFluxoAudio() {
  iniciandoGravacao = false;
  fluxoAudio?.getTracks?.().forEach((track) => track.stop());
  fluxoAudio = null;
  el('assistente-mic')?.classList.remove('recording');
  el('assistente-mic-label').textContent = 'Falar';
}

export async function alternarGravacao() {
  if (gravador?.state === 'recording') {
    gravador.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showToast('Gravação de áudio não está disponível neste aparelho.');
  }
  try {
    iniciandoGravacao = true;
    pararRespostaFalando();
    const nativo = plugin('MotoGearNative');
    if (nativo) {
      const permissao = await nativo.requestMicrophone();
      if (!permissao?.granted) {
        iniciandoGravacao = false;
        return showToast('O microfone precisa ser permitido nas configurações do aparelho.');
      }
    }
    if (!el('modal-assistente')?.classList.contains('active')) {
      iniciandoGravacao = false;
      return;
    }
    fluxoAudio = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!el('modal-assistente')?.classList.contains('active')) {
      encerrarFluxoAudio();
      return;
    }
    const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((item) => MediaRecorder.isTypeSupported(item));
    gravador = new MediaRecorder(fluxoAudio, tipo ? { mimeType: tipo } : undefined);
    pedacosAudio = [];
    gravador.ondataavailable = (evento) => evento.data.size && pedacosAudio.push(evento.data);
    gravador.onstop = async () => {
      const blob = new Blob(pedacosAudio, { type: gravador.mimeType || 'audio/webm' });
      encerrarFluxoAudio();
      if (blob.size) await transcreverBlob(blob);
    };
    gravador.start();
    iniciandoGravacao = false;
    el('assistente-mic').classList.add('recording');
    el('assistente-mic-label').textContent = 'Parar';
    el('assistente-status').textContent = 'Ouvindo... toque novamente para enviar';
    el('assistente-status').classList.remove('hidden');
  } catch (err) {
    encerrarFluxoAudio();
    console.error('Microfone indisponível', err);
    showToast('Autorize o microfone para enviar comandos por voz.');
  }
}

function preencher(campos, dados) {
  for (const [campo, id] of Object.entries(campos)) {
    if (dados[campo] !== undefined) setVal(id, dados[campo]);
  }
}

export function aplicarRascunho() {
  if (!rascunhoAtual) return;
  const { tipo, dados } = rascunhoAtual;
  const area = el('assistente-rascunho');
  const geracao = geracaoAssistente;
  area?.classList.add('assistant-draft-complete');
  rascunhoAtual = null;
  adicionarMensagem('assistant', 'Rascunho enviado para o formulário. Confira os dados e toque em Salvar para concluir.');
  setTimeout(async () => {
    if (geracao !== geracaoAssistente) return;
    renderRascunho(null);

    if (tipo === 'venda') {
      vendaEmPreparacao = null;
      fecharAssistente();
      const preenchida = await window.App.prepararVendaAssistente(dados.itens);
      if (geracao !== geracaoAssistente || !preenchida) return;
      showToast('Venda preenchida. Confira e escolha como receber.');
      return;
    }

    fecharAssistente();

    if (tipo === 'produto') {
      window.App.switchTab('estoque');
      window.App.abrirModalProduto();
      preencher({ nome: 'prod-nome', codigoBarras: 'prod-codigo', categoria: 'prod-categoria', marca: 'prod-marca', custo: 'prod-custo', venda: 'prod-venda', qtd: 'prod-qtd', min: 'prod-min' }, dados);
    } else if (tipo === 'servico') {
      window.App.switchTab('servicos');
      window.App.abrirModalServico();
      preencher({ nome: 'serv-nome', valor: 'serv-valor' }, dados);
    } else if (tipo === 'cliente') {
      window.App.switchTab('clientes');
      window.App.abrirModalCliente();
      preencher({ nome: 'cli-nome', tel: 'cli-tel', placa: 'cli-placa', moto: 'cli-moto' }, dados);
    } else if (tipo === 'fornecedor') {
      window.App.switchTab('fornecedores');
      window.App.abrirModalFornecedor();
      preencher({ nome: 'forn-nome', cnpj: 'forn-cnpj', tel: 'forn-tel', vendedor: 'forn-vendedor', obs: 'forn-obs' }, dados);
    } else if (tipo === 'despesa') {
      window.App.switchTab('caixa');
      window.App.abrirModalDespesa();
      preencher({ desc: 'despesa-desc', valor: 'despesa-valor' }, dados);
    }
    showToast('Rascunho preenchido. Confira antes de salvar.');
  }, 220);
}

export function enviarComEnter(evento) {
  if (evento.key === 'Enter' && !evento.shiftKey) {
    evento.preventDefault();
    enviarMensagem();
  }
}
