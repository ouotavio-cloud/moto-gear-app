/** Ajudante contextual: conversa, voz e preenchimento seguro de rascunhos. */

import { req } from './api.js';
import { abrirModal, fecharModal, el, esc, setVal, showToast, atualizarIcones } from './ui.js';

let historico = [];
let rascunhoAtual = null;
let gravador = null;
let pedacosAudio = [];
let fluxoAudio = null;

function telaAtual() {
  return document.querySelector('.tab-content.active')?.id || 'tab-inicio';
}

function adicionarMensagem(role, content) {
  historico.push({ role, content: String(content) });
  historico = historico.slice(-12);
  const lista = el('assistente-mensagens');
  const classe = role === 'user' ? 'assistant-message-user' : 'assistant-message-ai';
  lista.insertAdjacentHTML('beforeend', `<div class="assistant-message ${classe}">${esc(content)}</div>`);
  lista.scrollTop = lista.scrollHeight;
}

function renderSugestoes(sugestoes = []) {
  const area = el('assistente-sugestoes');
  area.innerHTML = sugestoes.map((texto) =>
    `<button type="button" class="assistant-chip" data-sugestao="${esc(texto)}" onclick="App.usarSugestaoIA(this.dataset.sugestao)">${esc(texto)}</button>`
  ).join('');
}

function rotuloRascunho(tipo) {
  return ({ produto: 'Produto', servico: 'Serviço', cliente: 'Cliente', fornecedor: 'Fornecedor', despesa: 'Despesa' })[tipo] || 'Cadastro';
}

function renderRascunho(rascunho) {
  rascunhoAtual = rascunho || null;
  const area = el('assistente-rascunho');
  if (!rascunhoAtual) {
    area.classList.add('hidden');
    area.innerHTML = '';
    return;
  }
  const linhas = Object.entries(rascunhoAtual.dados || {})
    .map(([campo, valor]) => `<div><span>${esc(campo)}</span><strong>${esc(valor)}</strong></div>`)
    .join('');
  area.innerHTML = `
    <p class="eyebrow">Rascunho de ${esc(rotuloRascunho(rascunhoAtual.tipo))}</p>
    <div class="assistant-draft-fields">${linhas}</div>
    <button type="button" class="btn-primary mt-3" onclick="App.aplicarRascunhoIA()"><i data-lucide="wand-sparkles"></i> Revisar no formulário</button>`;
  area.classList.remove('hidden');
  atualizarIcones();
}

function setOcupado(ocupado, texto = 'Pensando...') {
  el('assistente-enviar').disabled = ocupado;
  el('assistente-input').disabled = ocupado;
  el('assistente-status').textContent = ocupado ? texto : '';
  el('assistente-status').classList.toggle('hidden', !ocupado);
}

export function abrirAssistente() {
  abrirModal('modal-assistente');
  if (!historico.length) {
    adicionarMensagem('assistant', 'Oi! Posso explicar o Moto Gear ou preparar um cadastro para você revisar.');
    renderSugestoes(['Como faço uma venda no PIX?', 'Quero cadastrar um serviço', 'Como funciona o estoque mínimo?']);
  }
  setTimeout(() => el('assistente-input')?.focus(), 80);
}

export function fecharAssistente() {
  if (gravador?.state === 'recording') gravador.stop();
  fecharModal('modal-assistente');
}

export function usarSugestao(texto) {
  setVal('assistente-input', texto);
  enviarMensagem();
}

export async function enviarMensagem(textoForcado) {
  const campo = el('assistente-input');
  const mensagem = String(textoForcado ?? campo.value).trim();
  if (!mensagem || campo.disabled) return;
  campo.value = '';
  renderSugestoes([]);
  renderRascunho(null);
  const anteriores = historico.slice(-6);
  adicionarMensagem('user', mensagem);
  setOcupado(true);
  try {
    const resposta = await req('POST', '/assistente/conversar', { mensagem, tela: telaAtual(), historico: anteriores });
    adicionarMensagem('assistant', resposta.resposta);
    renderSugestoes(resposta.sugestoes);
    renderRascunho(resposta.rascunho);
  } catch (err) {
    adicionarMensagem('assistant', err.message || 'Não consegui responder agora.');
  } finally {
    setOcupado(false);
    campo.focus();
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
  setOcupado(true, 'Transcrevendo áudio...');
  try {
    const audioBase64 = await blobBase64(blob);
    const resposta = await req('POST', '/assistente/transcrever', { audioBase64, mimeType: blob.type || 'audio/webm' });
    setVal('assistente-input', resposta.texto);
    setOcupado(false);
    await enviarMensagem(resposta.texto);
  } catch (err) {
    showToast(err.message || 'Não consegui entender o áudio.');
  } finally {
    setOcupado(false);
  }
}

function encerrarFluxoAudio() {
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
    fluxoAudio = await navigator.mediaDevices.getUserMedia({ audio: true });
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
  rascunhoAtual = null;
  showToast('Rascunho preenchido. Confira antes de salvar.');
}

export function enviarComEnter(evento) {
  if (evento.key === 'Enter' && !evento.shiftKey) {
    evento.preventDefault();
    enviarMensagem();
  }
}
