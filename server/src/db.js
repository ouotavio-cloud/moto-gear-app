/**
 * Acesso ao banco.
 *
 * Em produção usa Postgres (Render) pelo driver `pg`. Sem DATABASE_URL, sobe um
 * Postgres embutido em memória (PGlite) — é o mesmo Postgres compilado para
 * WASM, então o SQL dos testes é exatamente o SQL que roda em produção.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));

let executar = null;
let comTransacao = null;
let fechar = async () => {};

function precisaSSL(url) {
  if (process.env.PGSSL === '0') return false;
  if (process.env.PGSSL === '1') return true;
  // O host interno do Render não usa TLS; o externo (*.render.com) exige.
  return /sslmode=require/.test(url) || /@[^/]*\.render\.com/.test(url);
}

export async function conectar({ databaseUrl = process.env.DATABASE_URL } = {}) {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: precisaSSL(databaseUrl) ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX ?? 5)
    });

    // Obrigatório com o driver `pg`: um cliente ocioso do pool que perde a
    // conexão (o Postgres do Render fecha conexão inativa periodicamente)
    // emite 'error' no pool. Sem este listener, Node trata como exceção não
    // tratada e derruba o processo inteiro — mata o servidor por uma simples
    // reconexão que o pool resolveria sozinho na próxima consulta.
    pool.on('error', (err) => {
      console.error('Erro numa conexão ociosa do pool (recuperável):', err.message);
    });

    executar = (sql, params) => pool.query(sql, params);
    comTransacao = async (fn) => {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await fn({ query: (sql, params) => cliente.query(sql, params) });
        await cliente.query('COMMIT');
        return resultado;
      } catch (err) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        cliente.release();
      }
    };
    fechar = () => pool.end();
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const pglite = new PGlite();
    await pglite.waitReady;

    executar = (sql, params) => pglite.query(sql, params);
    comTransacao = (fn) => pglite.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params) }));
    fechar = () => pglite.close();
  }

  await migrar();
}

/**
 * Remove comentários `--` antes de separar os comandos: um ponto e vírgula
 * escrito dentro de um comentário quebraria o `split` no meio de um CREATE.
 * Linhas com aspas são preservadas inteiras (não há comentário inline nelas).
 */
function comandosDo(sql) {
  const limpo = sql
    .split('\n')
    .map((linha) => {
      if (linha.trimStart().startsWith('--')) return '';
      if (linha.includes("'")) return linha;
      const corte = linha.indexOf('--');
      return corte === -1 ? linha : linha.slice(0, corte);
    })
    .join('\n');

  return limpo
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
}

async function migrar() {
  const sql = await readFile(join(AQUI, 'schema.sql'), 'utf8');
  for (const comando of comandosDo(sql)) await executar(comando);
}

export const query = (sql, params) => executar(sql, params);
export const transacao = (fn) => comTransacao(fn);
export const desconectar = () => fechar();

/** Primeira linha do resultado, ou null. */
export async function uma(sql, params) {
  const { rows } = await executar(sql, params);
  return rows[0] ?? null;
}

export async function todas(sql, params) {
  const { rows } = await executar(sql, params);
  return rows;
}
