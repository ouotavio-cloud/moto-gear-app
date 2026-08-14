import test from 'node:test';
import assert from 'node:assert/strict';
import { conectar, query, migrar, uma, desconectar } from '../src/db.js';

test('banco em formato antigo (sem organizacao_id) é recriado do zero sozinho', async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.DATABASE_URL;
  await conectar();

  try {
    // Simula o estado de produção de antes das organizações: tabelas do
    // formato antigo, sem organizacao_id em lugar nenhum.
    await query('DROP TABLE IF EXISTS ordens, transacoes, produtos, servicos, clientes, fornecedores, usuarios, organizacoes CASCADE');
    await query(
      'CREATE TABLE usuarios (id TEXT PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now())'
    );
    await query("INSERT INTO usuarios (id, usuario, senha_hash) VALUES ('velho-id', 'admin-antigo', 'sal:hash')");
    await query('CREATE TABLE produtos (id TEXT PRIMARY KEY, nome TEXT NOT NULL)');
    await query("INSERT INTO produtos (id, nome) VALUES ('p1', 'Peça de antes')");

    await migrar();

    const usuarioAntigo = await uma("SELECT id FROM usuarios WHERE usuario = 'admin-antigo'");
    assert.equal(usuarioAntigo, null, 'usuário do esquema antigo não pode sobreviver ao reset');

    const { rows: colunas } = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'usuarios'");
    assert.ok(
      colunas.some((c) => c.column_name === 'organizacao_id'),
      'a tabela usuarios recriada precisa ter organizacao_id'
    );

    const { rows: produtos } = await query('SELECT * FROM produtos');
    assert.equal(produtos.length, 0, 'estoque do formato antigo não pode sobreviver ao reset');
  } finally {
    await desconectar();
  }
});

test('banco já no formato novo não é mexido', async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.DATABASE_URL;
  await conectar();

  try {
    await migrar(); // roda de novo: não deve apagar nada, já está no formato certo.
    const { rows } = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'usuarios'");
    assert.ok(rows.some((c) => c.column_name === 'organizacao_id'));
  } finally {
    await desconectar();
  }
});
