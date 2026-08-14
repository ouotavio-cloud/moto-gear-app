/**
 * CRUD dos cadastros.
 *
 * Exclusão é sempre lógica (`ativo = FALSE`): OS antigas continuam apontando
 * para a peça ou o cliente removido, e o histórico precisa continuar legível.
 *
 * Toda função recebe `organizacaoId` e toda consulta filtra por ele: é o que
 * isola os dados de uma oficina das demais.
 */

import { randomUUID } from 'node:crypto';
import { query, uma, transacao } from './db.js';
import * as mapear from './mapeadores.js';
import { erro } from './negocio.js';

const novoId = () => randomUUID();
const dinheiro = (v) => Math.round((Number(v) || 0) * 100) / 100;
const inteiro = (v) => Math.trunc(Number(v) || 0);
const texto = (v) => String(v ?? '').trim();

/* -------------------------------- produtos -------------------------------- */

export function criarProduto(dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');

  return transacao(async (tx) => {
    const id = novoId();
    const qtd = inteiro(dados.qtd);
    const custo = dinheiro(dados.custo);

    await tx.query(
      `INSERT INTO produtos (id, organizacao_id, nome, categoria, marca, codigo_barras, custo, venda, qtd, minimo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        organizacaoId,
        nome,
        texto(dados.categoria),
        texto(dados.marca),
        texto(dados.codigoBarras),
        custo,
        dinheiro(dados.venda),
        qtd,
        inteiro(dados.min) || 2
      ]
    );

    if (qtd > 0) {
      await tx.query(
        `INSERT INTO transacoes (id, organizacao_id, descricao, valor, tipo, cliente_nome, origem_detalhada)
         VALUES ($1, $2, $3, $4, 'saida', 'Sistema', $5)`,
        [novoId(), organizacaoId, `Estoque Inicial: ${nome}`, dinheiro(qtd * custo), `Compra inicial de ${qtd} peça(s).`]
      );
    }

    const { rows } = await tx.query('SELECT * FROM produtos WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]);
    return mapear.produto(rows[0]);
  });
}

export function atualizarProduto(id, dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');

  return transacao(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM produtos WHERE id = $1 AND organizacao_id = $2 FOR UPDATE', [id, organizacaoId]);
    const anterior = rows[0];
    if (!anterior) throw erro(404, 'Produto não encontrado.');

    const qtd = inteiro(dados.qtd);
    const custo = dinheiro(dados.custo);

    await tx.query(
      `UPDATE produtos SET nome = $1, categoria = $2, marca = $3, codigo_barras = $4,
              custo = $5, venda = $6, qtd = $7, minimo = $8
       WHERE id = $9 AND organizacao_id = $10`,
      [nome, texto(dados.categoria), texto(dados.marca), texto(dados.codigoBarras), custo, dinheiro(dados.venda), qtd, inteiro(dados.min) || 2, id, organizacaoId]
    );

    const entrada = qtd - Number(anterior.qtd);
    if (entrada > 0) {
      await tx.query(
        `INSERT INTO transacoes (id, organizacao_id, descricao, valor, tipo, cliente_nome, origem_detalhada)
         VALUES ($1, $2, $3, $4, 'saida', 'Sistema', $5)`,
        [novoId(), organizacaoId, `Ajuste Estoque: ${nome}`, dinheiro(entrada * custo), `Entrada manual de ${entrada} peça(s).`]
      );
    }

    const { rows: atualizado } = await tx.query('SELECT * FROM produtos WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]);
    return mapear.produto(atualizado[0]);
  });
}

/* -------------------------------- serviços -------------------------------- */

export async function criarServico(dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');
  const id = novoId();
  await query('INSERT INTO servicos (id, organizacao_id, nome, valor, pecas) VALUES ($1, $2, $3, $4, $5)', [
    id,
    organizacaoId,
    nome,
    dinheiro(dados.valor),
    JSON.stringify(normalizarPecas(dados.pecas))
  ]);
  return mapear.servico(await uma('SELECT * FROM servicos WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]));
}

export async function atualizarServico(id, dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');
  const existente = await uma('SELECT id FROM servicos WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]);
  if (!existente) throw erro(404, 'Serviço não encontrado.');

  await query('UPDATE servicos SET nome = $1, valor = $2, pecas = $3 WHERE id = $4 AND organizacao_id = $5', [
    nome,
    dinheiro(dados.valor),
    JSON.stringify(normalizarPecas(dados.pecas)),
    id,
    organizacaoId
  ]);
  return mapear.servico(await uma('SELECT * FROM servicos WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]));
}

function normalizarPecas(pecas) {
  return (Array.isArray(pecas) ? pecas : [])
    .filter((p) => p?.produtoId)
    .map((p) => ({ produtoId: String(p.produtoId), qtd: Math.max(1, inteiro(p.qtd) || 1) }));
}

/* -------------------------------- clientes -------------------------------- */

export async function criarCliente(dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');
  const id = novoId();
  await query('INSERT INTO clientes (id, organizacao_id, nome, tel, placa, moto) VALUES ($1, $2, $3, $4, $5, $6)', [
    id,
    organizacaoId,
    nome,
    texto(dados.tel),
    texto(dados.placa).toUpperCase(),
    texto(dados.moto)
  ]);
  return mapear.cliente(await uma('SELECT * FROM clientes WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]));
}

export async function atualizarCliente(id, dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');
  const existente = await uma('SELECT id FROM clientes WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]);
  if (!existente) throw erro(404, 'Cliente não encontrado.');

  await query('UPDATE clientes SET nome = $1, tel = $2, placa = $3, moto = $4 WHERE id = $5 AND organizacao_id = $6', [
    nome,
    texto(dados.tel),
    texto(dados.placa).toUpperCase(),
    texto(dados.moto),
    id,
    organizacaoId
  ]);
  return mapear.cliente(await uma('SELECT * FROM clientes WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]));
}

/* ------------------------------ fornecedores ------------------------------- */

export async function criarFornecedor(dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');
  const id = novoId();
  await query('INSERT INTO fornecedores (id, organizacao_id, nome, cnpj, tel, vendedor, obs) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    id,
    organizacaoId,
    nome,
    texto(dados.cnpj),
    texto(dados.tel),
    texto(dados.vendedor),
    texto(dados.obs)
  ]);
  return mapear.fornecedor(await uma('SELECT * FROM fornecedores WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]));
}

export async function atualizarFornecedor(id, dados, organizacaoId) {
  const nome = texto(dados.nome);
  if (!nome) throw erro(400, 'Nome obrigatório.');
  const existente = await uma('SELECT id FROM fornecedores WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]);
  if (!existente) throw erro(404, 'Fornecedor não encontrado.');

  await query('UPDATE fornecedores SET nome = $1, cnpj = $2, tel = $3, vendedor = $4, obs = $5 WHERE id = $6 AND organizacao_id = $7', [
    nome,
    texto(dados.cnpj),
    texto(dados.tel),
    texto(dados.vendedor),
    texto(dados.obs),
    id,
    organizacaoId
  ]);
  return mapear.fornecedor(await uma('SELECT * FROM fornecedores WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]));
}

/* -------------------------------- exclusão --------------------------------- */

const TABELAS = { produtos: 'produtos', servicos: 'servicos', clientes: 'clientes', fornecedores: 'fornecedores' };

export async function desativar(entidade, id, organizacaoId) {
  const tabela = TABELAS[entidade];
  if (!tabela) throw erro(400, 'Entidade inválida.');
  const existente = await uma(`SELECT id FROM ${tabela} WHERE id = $1 AND organizacao_id = $2`, [id, organizacaoId]);
  if (!existente) throw erro(404, 'Registro não encontrado.');
  await query(`UPDATE ${tabela} SET ativo = FALSE WHERE id = $1 AND organizacao_id = $2`, [id, organizacaoId]);
}

/* ------------------------ importação em lote (planilha) -------------------- */

export function importarLote({ produtos = [], clientes = [], servicos = [] }, organizacaoId) {
  return transacao(async (tx) => {
    let total = 0;

    for (const p of produtos) {
      if (!texto(p.nome)) continue;
      await tx.query(
        `INSERT INTO produtos (id, organizacao_id, nome, categoria, marca, codigo_barras, custo, venda, qtd, minimo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          novoId(),
          organizacaoId,
          texto(p.nome),
          texto(p.categoria),
          texto(p.marca),
          texto(p.codigoBarras),
          dinheiro(p.custo),
          dinheiro(p.venda),
          inteiro(p.qtd),
          inteiro(p.min) || 2
        ]
      );
      total += 1;
    }

    for (const c of clientes) {
      if (!texto(c.nome)) continue;
      await tx.query('INSERT INTO clientes (id, organizacao_id, nome, tel, placa, moto) VALUES ($1, $2, $3, $4, $5, $6)', [
        novoId(),
        organizacaoId,
        texto(c.nome),
        texto(c.tel),
        texto(c.placa).toUpperCase(),
        texto(c.moto)
      ]);
      total += 1;
    }

    for (const s of servicos) {
      if (!texto(s.nome)) continue;
      await tx.query('INSERT INTO servicos (id, organizacao_id, nome, valor, pecas) VALUES ($1, $2, $3, $4, $5)', [
        novoId(),
        organizacaoId,
        texto(s.nome),
        dinheiro(s.valor),
        JSON.stringify(normalizarPecas(s.pecas))
      ]);
      total += 1;
    }

    return { total };
  });
}
