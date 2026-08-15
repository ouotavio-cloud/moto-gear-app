/** Montagem do Express: API em /api e a interface web servida na raiz. */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { criarRotas } from './rotas.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PASTA_WEB = join(AQUI, '..', '..', 'app', 'www');

export function criarApp() {
  const app = express();

  app.disable('x-powered-by');
  // O app Android chama a API de origem `https://localhost`; como a sessão é
  // por cabeçalho Bearer (não cookie), liberar a origem não expõe o usuário a
  // requisição forjada por outro site.
  app.use(cors({ origin: true }));
  // Limite generoso por causa da foto da nota em base64.
  app.use(express.json({ limit: process.env.LIMITE_JSON ?? '12mb' }));

  app.use('/api', criarRotas());

  app.use(express.static(PASTA_WEB, { index: 'index.html', maxAge: 0 }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(PASTA_WEB, 'index.html'));
  });

  app.use((req, res) => res.status(404).json({ erro: `Rota não encontrada: ${req.method} ${req.path}` }));

  // eslint-disable-next-line no-unused-vars -- o Express só reconhece o handler de erro com 4 argumentos
  app.use((err, _req, res, _next) => {
    // Erro com `status` foi lançado de propósito e a mensagem é para o usuário
    // ler (inclusive 503 de recurso não configurado). Sem `status`, é falha
    // inesperada: vai para o log e o usuário recebe texto genérico.
    const deliberado = Number.isInteger(err.status);
    if (!deliberado) console.error('Erro não tratado:', err);
    res.status(deliberado ? err.status : 500).json({ erro: deliberado ? err.message : 'Erro interno no servidor.' });
  });

  return app;
}
