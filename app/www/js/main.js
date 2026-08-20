/**
 * Ponto de entrada: cuida da sessão, registra os renderizadores de cada aba e
 * publica em `window.App` as funções chamadas pelos `onclick` do HTML.
 */

import { carregarEstado, entrar, cadastrarOficina, cadastrarFuncionario, temSessao, servidor, quandoDeslogar } from './api.js';
import { setRenderers, renderAll, switchTab, fecharModal, showToast, el, setVal, txt, carregando, pararCarregando, abrirMenu, fecharMenu, navegarMenu, atualizarIcones } from './ui.js';
import * as estoque from './estoque.js';
import * as servicos from './servicos.js';
import * as caixa from './caixa.js';
import * as clientes from './clientes.js';
import * as os from './os.js';
import * as analises from './analises.js';
import * as fornecedores from './fornecedores.js';
import * as backup from './backup.js';
import * as importar from './importar.js';
import * as barcode from './barcode.js';
import * as notafiscal from './notafiscal.js';
import * as configuracoes from './config.js';
import * as plugpag from './plugpag.js';
import * as pix from './pix.js';
import { carregarConfigPix } from './pix.js';
import * as atualizacao from './atualizacao.js';
import { isNativo } from './files.js';
import { renderDashboard } from './dashboard.js';

/* --------------------------------- sessão --------------------------------- */

let modoCadastro = false;
let tipoCadastro = 'oficina';

function atualizarModoLogin() {
  el('login-confirmar-linha').classList.toggle('hidden', !modoCadastro);
  el('login-tipo-cadastro-linha').classList.toggle('hidden', !modoCadastro);
  el('login-nome-oficina-linha').classList.toggle('hidden', !(modoCadastro && tipoCadastro === 'oficina'));
  el('login-codigo-convite-linha').classList.toggle('hidden', !(modoCadastro && tipoCadastro === 'funcionario'));
  el('login-tipo-oficina').classList.toggle('active', tipoCadastro === 'oficina');
  el('login-tipo-funcionario').classList.toggle('active', tipoCadastro === 'funcionario');
  el('login-botao').innerHTML = modoCadastro
    ? '<i data-lucide="user-plus"></i> Criar conta'
    : '<i data-lucide="log-in"></i> Entrar';
  el('login-troca-texto').textContent = modoCadastro ? 'Já tem conta?' : 'Ainda não tem conta?';
  el('login-troca-botao').textContent = modoCadastro ? 'Entrar' : 'Cadastre-se';
  el('login-erro').textContent = '';
}

function alternarModoLogin() {
  modoCadastro = !modoCadastro;
  atualizarModoLogin();
}

function escolherTipoCadastro(tipo) {
  tipoCadastro = tipo;
  atualizarModoLogin();
}

function mostrarLogin() {
  setVal('login-servidor', servidor());
  setVal('login-senha', '');
  setVal('login-senha-confirmar', '');
  setVal('login-nome-oficina', '');
  setVal('login-codigo-convite', '');
  modoCadastro = false;
  tipoCadastro = 'oficina';
  atualizarModoLogin();
  el('tela-login').classList.add('active');
  el('login-erro').textContent = '';
  document.body.dataset.logado = 'nao';
}

function esconderLogin() {
  el('tela-login').classList.remove('active');
  document.body.dataset.logado = 'sim';
}

function enviarFormLogin() {
  return modoCadastro ? fazerCadastro() : fazerLogin();
}

async function fazerLogin() {
  const url = txt('login-servidor');
  const usuario = txt('login-usuario');
  const senha = el('login-senha').value;

  if (!usuario || !senha) {
    el('login-erro').textContent = 'Informe usuário e senha.';
    return;
  }

  carregando('Entrando...');
  try {
    await entrar({ url, usuario, senha });
    await carregarEstado();
    esconderLogin();
    renderAll();
    carregarConfigPix();
    showToast('Bem-vindo!');
  } catch (err) {
    el('login-erro').textContent = err.message;
  } finally {
    pararCarregando();
  }
}

async function fazerCadastro() {
  const url = txt('login-servidor');
  const usuario = txt('login-usuario');
  const senha = el('login-senha').value;
  const confirmar = el('login-senha-confirmar').value;

  if (!usuario || !senha) {
    el('login-erro').textContent = 'Informe usuário e senha.';
    return;
  }
  if (senha !== confirmar) {
    el('login-erro').textContent = 'As senhas não coincidem.';
    return;
  }

  const nomeOficina = txt('login-nome-oficina');
  const codigoConvite = txt('login-codigo-convite');
  if (tipoCadastro === 'oficina' && !nomeOficina) {
    el('login-erro').textContent = 'Informe o nome da oficina.';
    return;
  }
  if (tipoCadastro === 'funcionario' && !codigoConvite) {
    el('login-erro').textContent = 'Informe o código de convite.';
    return;
  }

  carregando('Criando conta...');
  try {
    if (tipoCadastro === 'oficina') await cadastrarOficina({ url, usuario, senha, nomeOficina });
    else await cadastrarFuncionario({ url, usuario, senha, codigoConvite });

    await carregarEstado();
    esconderLogin();
    renderAll();
    carregarConfigPix();
    showToast('Conta criada. Bem-vindo!');
  } catch (err) {
    el('login-erro').textContent = err.message;
  } finally {
    pararCarregando();
  }
}

/* ------------------------------- funções da UI ---------------------------- */

const App = {
  switchTab,
  fecharModal,
  abrirMenu,
  fecharMenu,
  navegarMenu,
  fazerLogin,
  fazerCadastro,
  enviarFormLogin,
  alternarModoLogin,
  escolherTipoCadastro,
  gerarNovoCodigoConvite: configuracoes.gerarNovoCodigoConvite,

  // Estoque
  renderEstoque: estoque.renderEstoque,
  abrirModalProduto: () => estoque.abrirModalProduto(),
  editarProduto: estoque.editarProduto,
  salvarProduto: estoque.salvarProduto,
  excluirProduto: estoque.excluirProduto,
  addEstoqueRapido: estoque.addEstoqueRapido,
  removeEstoqueRapido: estoque.removeEstoqueRapido,

  // Serviços
  renderServicos: servicos.renderServicos,
  abrirModalServico: servicos.abrirModalServico,
  editarServico: servicos.editarServico,
  salvarServico: servicos.salvarServico,
  excluirServico: servicos.excluirServico,
  addPecaServico: servicos.addPecaServico,
  remPecaServico: servicos.remPecaServico,

  // Caixa
  renderCaixa: caixa.renderCaixa,
  abrirModalVenda: caixa.abrirModalVenda,
  mudarTipoVenda: caixa.mudarTipoVenda,
  addItemVenda: caixa.addItemVenda,
  remItemVenda: caixa.remItemVenda,
  salvarVenda: caixa.salvarVenda,
  venderNoPix: caixa.venderNoPix,
  abrirModalDespesa: caixa.abrirModalDespesa,
  salvarDespesa: caixa.salvarDespesa,
  exportarCaixaCSV: caixa.exportarCaixaCSV,
  limparCaixa: caixa.limparCaixa,

  // Clientes e OS
  renderClientes: clientes.renderClientes,
  abrirModalCliente: clientes.abrirModalCliente,
  editarCliente: clientes.editarCliente,
  salvarCliente: clientes.salvarCliente,
  excluirCliente: clientes.excluirCliente,
  abrirPerfilCliente: clientes.abrirPerfilCliente,
  setPCTab: clientes.setPCTab,
  quitarPendencia: clientes.quitarPendencia,
  abrirCentralOS: os.abrirCentralOS,
  abrirOSDaCentral: clientes.abrirOSDaCentral,
  abrirModalOS: os.abrirModalOS,
  abrirModalOrcamento: os.abrirModalOrcamento,
  addItemOS: os.addItemOS,
  remItemOS: os.remItemOS,
  mudarTipoItemOS: os.mudarTipoItemOS,
  salvarOS: os.salvarOS,
  editarOS: os.editarOS,
  verificarStatusOS: os.verificarStatusOS,
  transformarOrcamentoEmOS: os.transformarOrcamentoEmOS,

  // Análises e fornecedores
  setAnaliseTab: analises.setAnaliseTab,
  renderFornecedores: fornecedores.renderFornecedores,
  abrirModalFornecedor: fornecedores.abrirModalFornecedor,
  editarFornecedor: fornecedores.editarFornecedor,
  salvarFornecedor: fornecedores.salvarFornecedor,
  excluirFornecedor: fornecedores.excluirFornecedor,

  // Arquivos e configurações
  fazerBackup: backup.fazerBackup,
  restaurarBackup: backup.restaurarBackup,
  importarPlanilha: importar.importarPlanilha,
  abrirConfig: configuracoes.abrirConfig,
  salvarPreferencias: configuracoes.salvarPreferencias,
  trocarSenha: configuracoes.trocarSenha,
  sairDaConta: configuracoes.sairDaConta,

  // Código de barras e nota fiscal
  escanearParaProduto: barcode.escanearParaProduto,
  escanearNoEstoque: barcode.escanearNoEstoque,
  abrirLeitorNota: notafiscal.abrirLeitorNota,
  processarFotoNota: notafiscal.processarFotoNota,
  confirmarNota: notafiscal.confirmarNota,
  cancelarNota: notafiscal.cancelarNota,

  // Maquininha PlugPag
  ppDebito: () => plugpag.executarCobranca('debito', 1),
  ppCreditoVista: () => plugpag.executarCobranca('credito_vista', 1),
  ppCreditoParc: () => plugpag.escolherParcelas(),
  ppConfirmarParc: () => {
    const p = parseInt(document.getElementById('pp-parcelas-qtd').value) || 2;
    plugpag.executarCobranca('credito_parc', p);
  },
  ppPix: () => plugpag.executarCobranca('pix', 1),
  abortarPagamento: plugpag.abortarPagamento,
  fecharPlugPag: plugpag.fecharPlugPag,
  venderNoCartao: caixa.venderNoCartao,
  cobrarOSnoCartao: os.cobrarOSnoCartao,
  cobrarPendenciaCartao: clientes.cobrarPendenciaCartao,

  // Pix (copia e cola + QR)
  salvarPix: configuracoes.salvarPix,
  copiarPix: pix.copiarPix,
  confirmarRecebimentoPix: pix.confirmarRecebimentoPix,
  fecharPix: pix.fecharPix,

  // Atualização do app
  verificarAtualizacao: atualizacao.verificarAtualizacao,
  baixarAtualizacao: atualizacao.baixarAtualizacao,
  adiarAtualizacao: atualizacao.adiarAtualizacao
};

window.App = App;

setRenderers({
  inicio: renderDashboard,
  estoque: estoque.renderEstoque,
  servicos: servicos.renderServicos,
  caixa: caixa.renderCaixa,
  clientes: clientes.renderClientes,
  fornecedores: fornecedores.renderFornecedores,
  analises: analises.renderAnalises,
  perfil: clientes.renderPerfil
});

quandoDeslogar(mostrarLogin);

async function iniciar() {
  if (temSessao()) {
    try {
      await carregarEstado();
      esconderLogin();
      renderAll();
      carregarConfigPix();
    } catch (err) {
      console.error('Não consegui carregar o estado inicial', err);
      mostrarLogin();
      el('login-erro').textContent = err.message;
    }
  } else {
    mostrarLogin();
  }

  document.body.dataset.pronto = 'sim';
  atualizarIcones();

  // Só o APK se atualiza por download; no navegador basta recarregar a página.
  if (isNativo()) atualizacao.verificarAtualizacao();
}

iniciar();
