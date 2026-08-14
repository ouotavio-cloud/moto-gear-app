/** Rotas da API. */

import { Router } from 'express';
import { autenticar, cadastrarUsuario, exigirLogin, trocarSenha } from './auth.js';
import * as negocio from './negocio.js';
import * as cadastros from './cadastros.js';
import { lerNotaFiscal, iaDisponivel } from './ia.js';

/** Encaminha erro de handler assíncrono para o middleware de erro do Express. */
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function criarRotas() {
  const api = Router();

  api.get('/saude', (_req, res) => res.json({ ok: true, ia: iaDisponivel() }));

  api.post(
    '/auth/login',
    rota(async (req, res) => {
      const { usuario, senha } = req.body ?? {};
      if (!usuario || !senha) return res.status(400).json({ erro: 'Informe usuário e senha.' });

      const sessao = await autenticar(String(usuario).trim(), String(senha));
      if (!sessao) return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
      res.json(sessao);
    })
  );

  api.post(
    '/auth/cadastro',
    rota(async (req, res) => {
      const { usuario, senha } = req.body ?? {};
      if (!usuario || !senha) return res.status(400).json({ erro: 'Informe usuário e senha.' });

      await cadastrarUsuario(usuario, senha);
      const sessao = await autenticar(String(usuario).trim(), String(senha));
      res.status(201).json(sessao);
    })
  );

  // Tudo daqui para baixo exige sessão válida.
  api.use(exigirLogin);

  api.get('/auth/eu', (req, res) => res.json({ usuario: req.usuario.usuario }));

  api.post(
    '/auth/senha',
    rota(async (req, res) => {
      const { senhaAtual, senhaNova } = req.body ?? {};
      await trocarSenha(req.usuario.sub, String(senhaAtual ?? ''), String(senhaNova ?? ''));
      res.json({ ok: true });
    })
  );

  api.get(
    '/estado',
    rota(async (_req, res) => res.json(await negocio.estadoCompleto()))
  );

  /* ------------------------------- cadastros ------------------------------- */

  const criadores = {
    produtos: cadastros.criarProduto,
    servicos: cadastros.criarServico,
    clientes: cadastros.criarCliente,
    fornecedores: cadastros.criarFornecedor
  };

  const atualizadores = {
    produtos: cadastros.atualizarProduto,
    servicos: cadastros.atualizarServico,
    clientes: cadastros.atualizarCliente,
    fornecedores: cadastros.atualizarFornecedor
  };

  api.post(
    '/:entidade(produtos|servicos|clientes|fornecedores)',
    rota(async (req, res) => res.status(201).json(await criadores[req.params.entidade](req.body ?? {})))
  );

  api.put(
    '/:entidade(produtos|servicos|clientes|fornecedores)/:id',
    rota(async (req, res) => res.json(await atualizadores[req.params.entidade](req.params.id, req.body ?? {})))
  );

  api.delete(
    '/:entidade(produtos|servicos|clientes|fornecedores)/:id',
    rota(async (req, res) => {
      await cadastros.desativar(req.params.entidade, req.params.id);
      res.json({ ok: true });
    })
  );

  /* --------------------------- estoque e caixa ----------------------------- */

  api.post(
    '/produtos/:id/ajuste',
    rota(async (req, res) => {
      await negocio.ajusteRapido({ produtoId: req.params.id, delta: req.body?.delta });
      res.json({ ok: true });
    })
  );

  api.post(
    '/vendas',
    rota(async (req, res) => res.status(201).json(await negocio.registrarVenda(req.body ?? {})))
  );

  api.post(
    '/despesas',
    rota(async (req, res) => {
      await negocio.registrarDespesa(req.body ?? {});
      res.status(201).json({ ok: true });
    })
  );

  api.delete(
    '/transacoes',
    rota(async (_req, res) => {
      await negocio.limparCaixa();
      res.json({ ok: true });
    })
  );

  /* ------------------------- ordens e orçamentos --------------------------- */

  api.post(
    '/ordens',
    rota(async (req, res) => res.status(201).json(await negocio.salvarOrdem(req.body ?? {})))
  );

  api.put(
    '/ordens/:id',
    rota(async (req, res) => res.json(await negocio.salvarOrdem({ ...(req.body ?? {}), id: req.params.id })))
  );

  api.post(
    '/orcamentos/:id/aprovar',
    rota(async (req, res) => res.status(201).json(await negocio.aprovarOrcamento(req.params.id)))
  );

  api.post(
    '/os/:id/quitar',
    rota(async (req, res) => res.json(await negocio.quitarPendencia(req.params.id)))
  );

  /* ------------------------------ nota fiscal ------------------------------ */

  api.post(
    '/nota-fiscal/ler',
    rota(async (req, res) => res.json(await lerNotaFiscal(req.body ?? {})))
  );

  api.post(
    '/nota-fiscal/entrada',
    rota(async (req, res) => res.status(201).json(await negocio.entradaPorNota(req.body ?? {})))
  );

  /* --------------------------- backup e planilha --------------------------- */

  api.get(
    '/backup',
    rota(async (_req, res) => {
      const estado = await negocio.estadoCompleto();
      res.json({ _meta: { versao: 2, app: 'Moto Gear', gerado: new Date().toISOString() }, ...estado });
    })
  );

  api.post(
    '/restaurar',
    rota(async (req, res) => res.json(await negocio.restaurarBackup(req.body ?? {})))
  );

  api.post(
    '/importar',
    rota(async (req, res) => res.status(201).json(await cadastros.importarLote(req.body ?? {})))
  );

  return api;
}
