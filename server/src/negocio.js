/**
 * Regras de negócio. Tudo que mexe em estoque e caixa mora aqui, dentro de uma
 * transação de banco, para que duas pessoas usando o app ao mesmo tempo não
 * consigam vender a mesma peça duas vezes.
 *
 * Toda função recebe `organizacaoId` e toda consulta filtra por ele: é o que
 * isola os dados de uma oficina das demais.
 *
 * Regras que valem a pena ter em mente:
 * - Orçamento não toca em estoque nem em caixa; só quando vira OS.
 * - O estoque de uma OS é debitado uma única vez, ao entrar em "Andamento" ou
 *   "Concluída" (a flag `estoque_debitado` garante isso).
 * - Cancelar uma OS já debitada devolve as peças.
 * - Concluir lança no caixa apenas o valor pago na hora; o resto vira pendência.
 */

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query, uma, todas, transacao } from './db.js';
import * as mapear from './mapeadores.js';
import { segredo } from './auth.js';

export const erro = (status, mensagem) => Object.assign(new Error(mensagem), { status });

const novoId = () => randomUUID();
const dinheiro = (v) => Math.round((Number(v) || 0) * 100) / 100;
const inteiro = (v, minimo = 0) => Math.max(minimo, Math.trunc(Number(v) || 0));

/* --------------------------------- estado --------------------------------- */

export async function estadoCompleto(organizacaoId) {
  const [produtos, servicos, clientes, fornecedores, ordens, transacoes, org] = await Promise.all([
    todas('SELECT * FROM produtos WHERE organizacao_id = $1 AND ativo = TRUE ORDER BY nome', [organizacaoId]),
    todas('SELECT * FROM servicos WHERE organizacao_id = $1 AND ativo = TRUE ORDER BY nome', [organizacaoId]),
    todas('SELECT * FROM clientes WHERE organizacao_id = $1 AND ativo = TRUE ORDER BY nome', [organizacaoId]),
    todas('SELECT * FROM fornecedores WHERE organizacao_id = $1 AND ativo = TRUE ORDER BY nome', [organizacaoId]),
    todas('SELECT * FROM ordens WHERE organizacao_id = $1 ORDER BY data', [organizacaoId]),
    todas('SELECT * FROM transacoes WHERE organizacao_id = $1 ORDER BY data', [organizacaoId]),
    uma('SELECT pix_chave, pix_nome, pix_cidade FROM organizacoes WHERE id = $1', [organizacaoId])
  ]);

  return {
    produtos: produtos.map(mapear.produto),
    servicos: servicos.map(mapear.servico),
    clientes: clientes.map(mapear.cliente),
    fornecedores: fornecedores.map(mapear.fornecedor),
    os: ordens.filter((o) => o.tipo === 'os').map(mapear.ordem),
    orcamentos: ordens.filter((o) => o.tipo === 'orcamento').map(mapear.ordem),
    transacoes: transacoes.map(mapear.transacao),
    pix: { chave: org?.pix_chave ?? '', nome: org?.pix_nome ?? '', cidade: org?.pix_cidade ?? '' }
  };
}

/* ------------------------------- transações ------------------------------- */

async function lancar(tx, organizacaoId, { desc, valor, tipo, clienteNome = 'Avulso', origemDetalhada = '', origem = null, itens = null, cotacaoId = null }) {
  const id = novoId();
  const { rows } = await tx.query(
    `INSERT INTO transacoes (id, organizacao_id, descricao, valor, tipo, cliente_nome, origem_detalhada, origem, itens, cotacao_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (organizacao_id, cotacao_id) WHERE cotacao_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [id, organizacaoId, desc, dinheiro(valor), tipo, clienteNome, origemDetalhada, origem, itens ? JSON.stringify(itens) : null, cotacaoId]
  );
  return rows[0]?.id ?? null;
}

export function registrarDespesa({ desc, valor }, organizacaoId) {
  const descricao = String(desc ?? '').trim();
  if (!descricao) throw erro(400, 'Descrição obrigatória.');
  if (dinheiro(valor) <= 0) throw erro(400, 'Informe um valor maior que zero.');
  return transacao((tx) =>
    lancar(tx, organizacaoId, { desc: descricao, valor, tipo: 'saida', clienteNome: 'Sistema', origemDetalhada: 'Lançamento manual de despesa' })
  );
}

export async function limparCaixa(organizacaoId) {
  await query('DELETE FROM transacoes WHERE organizacao_id = $1', [organizacaoId]);
}

/* -------------------------------- estoque --------------------------------- */

/** Soma as peças que saem por item da OS, incluindo as embutidas nos serviços. */
async function calcularBaixas(tx, itens, organizacaoId) {
  const porProduto = new Map();
  const somar = (produtoId, qtd) => porProduto.set(produtoId, (porProduto.get(produtoId) ?? 0) + qtd);

  for (const item of itens) {
    if (item.tipo === 'produto') {
      somar(item.itemId, item.qtd);
      continue;
    }
    const { rows } = await tx.query('SELECT pecas FROM servicos WHERE id = $1 AND organizacao_id = $2', [item.itemId, organizacaoId]);
    const pecas = rows[0]?.pecas ?? [];
    const lista = Array.isArray(pecas) ? pecas : JSON.parse(pecas || '[]');
    for (const peca of lista) somar(peca.produtoId, Number(peca.qtd) * item.qtd);
  }

  return [...porProduto].map(([produtoId, qtd]) => ({ produtoId, qtd }));
}

/**
 * Aplica as baixas travando as linhas envolvidas. `sinal` -1 debita, +1 devolve.
 * A trava é o que impede duas vendas simultâneas de furarem o estoque.
 */
async function moverEstoque(tx, baixas, sinal, organizacaoId, permitirNegativo = false) {
  const pendencias = [];
  for (const { produtoId, qtd } of baixas) {
    const { rows } = await tx.query('SELECT nome, qtd FROM produtos WHERE id = $1 AND organizacao_id = $2 FOR UPDATE', [produtoId, organizacaoId]);
    const produto = rows[0];
    if (!produto) throw erro(400, 'Uma das peças não existe mais no estoque.');
    const novo = Number(produto.qtd) + sinal * qtd;
    if (novo < 0 && !permitirNegativo) throw erro(409, `Estoque insuficiente: ${produto.nome} (tem ${produto.qtd}, precisa de ${qtd}).`);
    if (novo < 0) pendencias.push({ produtoId, nome: produto.nome, faltam: Math.abs(novo) });
    await tx.query('UPDATE produtos SET qtd = $1 WHERE id = $2 AND organizacao_id = $3', [novo, produtoId, organizacaoId]);
  }
  return pendencias;
}

/** Confere as mesmas baixas da venda sem alterar o estoque. */
async function validarEstoque(tx, baixas, organizacaoId) {
  for (const { produtoId, qtd } of baixas) {
    const { rows } = await tx.query('SELECT nome, qtd FROM produtos WHERE id = $1 AND organizacao_id = $2 FOR UPDATE', [produtoId, organizacaoId]);
    const produto = rows[0];
    if (!produto) throw erro(400, 'Uma das peças não existe mais no estoque.');
    if (Number(produto.qtd) < qtd) {
      throw erro(409, `Estoque insuficiente: ${produto.nome} (tem ${produto.qtd}, precisa de ${qtd}).`);
    }
  }
}

/* --------------------------------- vendas --------------------------------- */

export function registrarVenda({ itens, cotacao }, organizacaoId) {
  return transacao(async (tx) => {
    let total;
    let detalhados;
    let baixas;
    let cotacaoId = null;
    if (cotacao) {
      let dados;
      try { dados = jwt.verify(String(cotacao), segredo()); } catch { throw erro(409, 'A cotação da venda expirou. Revise a venda novamente.'); }
      if (
        dados?.tipo !== 'venda-cotacao'
        || dados?.organizacaoId !== organizacaoId
        || !Array.isArray(dados?.itens)
        || !Array.isArray(dados?.baixas)
        || !dados?.cotacaoId
      ) {
        throw erro(400, 'Cotação da venda inválida.');
      }
      total = dinheiro(dados.total);
      detalhados = dados.itens;
      baixas = dados.baixas;
      cotacaoId = String(dados.cotacaoId);
    } else {
      ({ total, detalhados } = await precificar(tx, itens, organizacaoId));
      baixas = await calcularBaixas(tx, detalhados, organizacaoId);
    }

    const resumo = detalhados.map((d) => `${d.qtd}x ${d.nome}`).join(', ');
    const lancamento = {
      desc: `Venda Balcão: ${resumo}`,
      valor: total,
      tipo: 'entrada',
      clienteNome: 'Venda Balcão Avulsa',
      origemDetalhada: resumo,
      origem: 'venda',
      itens: detalhados.map(({ tipo: t, itemId: i, nome: n, qtd: q }) => ({ tipo: t, itemId: i, nome: n, qtd: q })),
      cotacaoId
    };

    // O lançamento com índice único é feito primeiro: duplo toque ou retry da
    // mesma cotação retorna o resultado anterior sem duplicar caixa/estoque.
    if (cotacao && !await lancar(tx, organizacaoId, lancamento)) {
      return { total, estoquePendente: [], repetida: true };
    }

    // Uma cotação é usada depois que Dinheiro, Cartão ou Pix já foi confirmado.
    // Se outra pessoa consumir a última peça nesse intervalo, registrar a venda
    // e sinalizar a falta é mais seguro que deixar um pagamento aprovado órfão.
    const estoquePendente = await moverEstoque(tx, baixas, -1, organizacaoId, Boolean(cotacao));
    if (!cotacao) await lancar(tx, organizacaoId, lancamento);

    return { total, estoquePendente };
  });
}

export function cotacaoVenda({ itens }, organizacaoId) {
  return transacao(async (tx) => {
    const { total, detalhados } = await precificar(tx, itens, organizacaoId);
    const baixas = await calcularBaixas(tx, detalhados, organizacaoId);
    await validarEstoque(tx, baixas, organizacaoId);
    const cotacao = jwt.sign(
      { tipo: 'venda-cotacao', cotacaoId: novoId(), organizacaoId, total, itens: detalhados, baixas },
      segredo()
    );
    return { total, itens: detalhados, cotacao };
  });
}

/** Ajuste de uma unidade pelos botões +/- do estoque. */
export function ajusteRapido({ produtoId, delta }, organizacaoId) {
  const passo = Number(delta) === -1 ? -1 : 1;

  return transacao(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM produtos WHERE id = $1 AND organizacao_id = $2 FOR UPDATE', [produtoId, organizacaoId]);
    const registro = rows[0];
    if (!registro) throw erro(404, 'Produto não encontrado.');

    const atual = Number(registro.qtd);
    if (passo === -1 && atual <= 0) throw erro(409, 'Estoque zerado!');

    await tx.query('UPDATE produtos SET qtd = $1 WHERE id = $2 AND organizacao_id = $3', [atual + passo, produtoId, organizacaoId]);

    if (passo === 1) {
      await lancar(tx, organizacaoId, {
        desc: `Reposição Rápida: ${registro.nome}`,
        valor: registro.custo,
        tipo: 'saida',
        clienteNome: 'Sistema',
        origemDetalhada: 'Adição manual no estoque (+1)'
      });
    } else {
      await lancar(tx, organizacaoId, {
        desc: `Venda Avulsa/Rápida: ${registro.nome}`,
        valor: registro.venda,
        tipo: 'entrada',
        clienteNome: 'Venda Balcão Rápida',
        origemDetalhada: 'Remoção manual no estoque (-1)',
        origem: 'venda',
        itens: [{ tipo: 'produto', itemId: registro.id, nome: registro.nome, qtd: 1 }]
      });
    }
  });
}

/* ----------------------------- ordens de serviço --------------------------- */

/** Preenche nome e preço de cada item a partir do banco — o cliente só manda id e quantidade. */
async function precificar(tx, itens, organizacaoId) {
  if (!Array.isArray(itens) || !itens.length) throw erro(400, 'Adicione ao menos um item.');

  const detalhados = [];
  let total = 0;

  for (const bruto of itens) {
    const qtd = inteiro(bruto.qtd, 1) || 1;

    if (bruto.tipo === 'produto') {
      const { rows } = await tx.query('SELECT id, nome, venda FROM produtos WHERE id = $1 AND organizacao_id = $2 AND ativo = TRUE', [
        bruto.itemId,
        organizacaoId
      ]);
      const p = rows[0];
      if (!p) throw erro(400, 'Peça não encontrada no estoque.');
      const valor = dinheiro(Number(p.venda) * qtd);
      detalhados.push({ tipo: 'produto', itemId: p.id, nome: p.nome, qtd, total: valor });
      total += valor;
      continue;
    }

    if (bruto.tipo === 'servico') {
      const { rows } = await tx.query('SELECT id, nome, valor, pecas FROM servicos WHERE id = $1 AND organizacao_id = $2 AND ativo = TRUE', [
        bruto.itemId,
        organizacaoId
      ]);
      const s = rows[0];
      if (!s) throw erro(400, 'Serviço não encontrado.');

      const pecas = Array.isArray(s.pecas) ? s.pecas : JSON.parse(s.pecas || '[]');
      let unitario = Number(s.valor);
      for (const peca of pecas) {
        const { rows: pr } = await tx.query('SELECT venda FROM produtos WHERE id = $1 AND organizacao_id = $2', [peca.produtoId, organizacaoId]);
        if (pr[0]) unitario += Number(pr[0].venda) * Number(peca.qtd);
      }

      const valor = dinheiro(unitario * qtd);
      detalhados.push({ tipo: 'servico', itemId: s.id, nome: s.nome, qtd, total: valor });
      total += valor;
      continue;
    }

    throw erro(400, 'Item com tipo inválido.');
  }

  return { detalhados, total: dinheiro(total), nome: detalhados[0].nome };
}

const STATUS_VALIDOS = ['Pendente', 'Andamento', 'Concluída', 'Cancelada'];

export function salvarOrdem({ id, tipo, clienteId, itens, valorTotal, status, tempoGasto, valorPago }, organizacaoId) {
  if (tipo !== 'os' && tipo !== 'orcamento') throw erro(400, 'Tipo inválido.');

  return transacao(async (tx) => {
    const existente = id
      ? (await tx.query('SELECT * FROM ordens WHERE id = $1 AND organizacao_id = $2 FOR UPDATE', [id, organizacaoId])).rows[0]
      : null;
    if (id && !existente) throw erro(404, 'Registro não encontrado.');

    const dono = existente?.cliente_id ?? clienteId;
    const { rows: cli } = await tx.query('SELECT nome FROM clientes WHERE id = $1 AND organizacao_id = $2 AND ativo = TRUE', [dono, organizacaoId]);
    if (!cli[0]) throw erro(400, 'Cliente não encontrado.');

    const { detalhados, total: totalCalculado } = await precificar(tx, itens, organizacaoId);
    // O total é editável na tela (desconto negociado); sem valor explícito, vale o calculado.
    const total = valorTotal === undefined || valorTotal === null || valorTotal === '' ? totalCalculado : dinheiro(valorTotal);
    if (total < 0) throw erro(400, 'O total não pode ser negativo.');

    if (tipo === 'orcamento') {
      const ordemId = existente?.id ?? novoId();
      if (existente) {
        await tx.query('UPDATE ordens SET itens = $1, valor_total = $2 WHERE id = $3 AND organizacao_id = $4', [
          JSON.stringify(detalhados),
          total,
          ordemId,
          organizacaoId
        ]);
      } else {
        await tx.query(
          `INSERT INTO ordens (id, organizacao_id, cliente_id, tipo, itens, valor_total, status)
           VALUES ($1, $2, $3, 'orcamento', $4, $5, 'Pendente')`,
          [ordemId, organizacaoId, dono, JSON.stringify(detalhados), total]
        );
      }
      const { rows } = await tx.query('SELECT * FROM ordens WHERE id = $1 AND organizacao_id = $2', [ordemId, organizacaoId]);
      return mapear.ordem(rows[0]);
    }

    const statusAnterior = existente?.status ?? '';
    const statusNovo = existente ? String(status ?? statusAnterior) : 'Pendente';
    if (!STATUS_VALIDOS.includes(statusNovo)) throw erro(400, 'Status inválido.');
    if (statusAnterior === 'Concluída' || statusAnterior === 'Cancelada') {
      throw erro(409, 'Esta O.S. já está finalizada e não pode ser alterada.');
    }

    let debitado = Boolean(existente?.estoque_debitado);
    const ordemId = existente?.id ?? novoId();
    const itensJson = JSON.stringify(detalhados);

    if ((statusNovo === 'Andamento' || statusNovo === 'Concluída') && !debitado) {
      await moverEstoque(tx, await calcularBaixas(tx, detalhados, organizacaoId), -1, organizacaoId);
      debitado = true;
    } else if (statusNovo === 'Cancelada' && debitado) {
      // Devolve o que foi debitado com base nos itens já gravados, não nos
      // recebidos agora: é o que realmente saiu do estoque.
      const itensGravados = Array.isArray(existente.itens) ? existente.itens : JSON.parse(existente.itens || '[]');
      await moverEstoque(tx, await calcularBaixas(tx, itensGravados, organizacaoId), +1, organizacaoId);
      debitado = false;
    }

    let pago = Number(existente?.valor_pago ?? 0);
    const pagoAgora = dinheiro(valorPago);
    const fechandoAgora = statusNovo === 'Concluída' && statusAnterior !== 'Concluída';

    if (fechandoAgora && pagoAgora > 0) {
      pago += pagoAgora;
      await lancar(tx, organizacaoId, {
        desc: `Fechamento OS #${ordemId.slice(-4)}`,
        valor: pagoAgora,
        tipo: 'entrada',
        clienteNome: cli[0].nome,
        origemDetalhada: detalhados.map((i) => `${i.tipo === 'produto' ? 'Peça' : 'Serviço'}: ${i.nome}`).join(' + '),
        origem: 'os',
        itens: detalhados.map(({ tipo: t, itemId, nome, qtd }) => ({ tipo: t, itemId, nome, qtd }))
      });
    }

    if (existente) {
      await tx.query(
        `UPDATE ordens SET itens = $1, valor_total = $2, status = $3, estoque_debitado = $4, valor_pago = $5, tempo_gasto = $6
         WHERE id = $7 AND organizacao_id = $8`,
        [itensJson, total, statusNovo, debitado, pago, inteiro(tempoGasto), ordemId, organizacaoId]
      );
    } else {
      await tx.query(
        `INSERT INTO ordens (id, organizacao_id, cliente_id, tipo, itens, valor_total, status, estoque_debitado, valor_pago, tempo_gasto)
         VALUES ($1, $2, $3, 'os', $4, $5, $6, $7, $8, $9)`,
        [ordemId, organizacaoId, dono, itensJson, total, statusNovo, debitado, pago, inteiro(tempoGasto)]
      );
    }

    const { rows } = await tx.query('SELECT * FROM ordens WHERE id = $1 AND organizacao_id = $2', [ordemId, organizacaoId]);
    return mapear.ordem(rows[0]);
  });
}

export function aprovarOrcamento(orcamentoId, organizacaoId) {
  return transacao(async (tx) => {
    const { rows } = await tx.query("SELECT * FROM ordens WHERE id = $1 AND organizacao_id = $2 AND tipo = 'orcamento'", [
      orcamentoId,
      organizacaoId
    ]);
    const orcamento = rows[0];
    if (!orcamento) throw erro(404, 'Orçamento não encontrado.');

    const id = novoId();
    const itens = Array.isArray(orcamento.itens) ? orcamento.itens : JSON.parse(orcamento.itens || '[]');
    await tx.query(
      `INSERT INTO ordens (id, organizacao_id, cliente_id, tipo, itens, valor_total, status)
       VALUES ($1, $2, $3, 'os', $4, $5, 'Pendente')`,
      [id, organizacaoId, orcamento.cliente_id, JSON.stringify(itens), orcamento.valor_total]
    );

    const { rows: nova } = await tx.query('SELECT * FROM ordens WHERE id = $1 AND organizacao_id = $2', [id, organizacaoId]);
    return mapear.ordem(nova[0]);
  });
}

export function quitarPendencia(osId, organizacaoId) {
  return transacao(async (tx) => {
    const { rows } = await tx.query("SELECT * FROM ordens WHERE id = $1 AND organizacao_id = $2 AND tipo = 'os' FOR UPDATE", [
      osId,
      organizacaoId
    ]);
    const os = rows[0];
    if (!os) throw erro(404, 'O.S. não encontrada.');

    const restante = dinheiro(Number(os.valor_total) - Number(os.valor_pago));
    if (restante <= 0) throw erro(409, 'Esta O.S. já está quitada.');

    await tx.query('UPDATE ordens SET valor_pago = valor_total WHERE id = $1 AND organizacao_id = $2', [osId, organizacaoId]);

    const { rows: cli } = await tx.query('SELECT nome FROM clientes WHERE id = $1 AND organizacao_id = $2', [os.cliente_id, organizacaoId]);
    await lancar(tx, organizacaoId, {
      desc: `Quitação de pendência (OS #${String(osId).slice(-4)})`,
      valor: restante,
      tipo: 'entrada',
      clienteNome: cli[0]?.nome ?? 'Cliente removido',
      origemDetalhada: 'Recebimento de valores em atraso.'
    });

    return { valorRecebido: restante };
  });
}

/* ------------------------------ backup/restauração ------------------------- */

const TABELAS_DADOS = ['transacoes', 'ordens', 'servicos', 'produtos', 'clientes', 'fornecedores'];

/**
 * Substitui os dados da oficina pelo conteúdo do backup. Aceita tanto o
 * formato exportado por este servidor quanto o do app antigo (v1), que tem a
 * mesma forma.
 */
export function restaurarBackup(dados, organizacaoId) {
  const listas = {
    produtos: dados?.produtos ?? [],
    servicos: dados?.servicos ?? [],
    clientes: dados?.clientes ?? [],
    fornecedores: dados?.fornecedores ?? [],
    os: dados?.os ?? [],
    orcamentos: dados?.orcamentos ?? [],
    transacoes: dados?.transacoes ?? []
  };

  // Basta uma das listas conhecidas estar presente como array. Um backup
  // legitimamente vazio (oficina recém-aberta) precisa ser aceito; o que se
  // quer barrar é arquivo de outra natureza.
  const CHAVES = ['produtos', 'servicos', 'clientes', 'fornecedores', 'os', 'orcamentos', 'transacoes'];
  if (!CHAVES.some((chave) => Array.isArray(dados?.[chave]))) {
    throw erro(400, 'O arquivo não parece ser um backup do Moto Gear.');
  }

  return transacao(async (tx) => {
    for (const tabela of TABELAS_DADOS) await tx.query(`DELETE FROM ${tabela} WHERE organizacao_id = $1`, [organizacaoId]);

    for (const c of listas.clientes) {
      await tx.query('INSERT INTO clientes (id, organizacao_id, nome, tel, placa, moto, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
        String(c.id),
        organizacaoId,
        String(c.nome ?? 'Sem nome'),
        String(c.tel ?? ''),
        String(c.placa ?? ''),
        String(c.moto ?? ''),
        c.ativo !== false
      ]);
    }

    for (const p of listas.produtos) {
      await tx.query(
        `INSERT INTO produtos (id, organizacao_id, nome, categoria, marca, codigo_barras, custo, venda, qtd, minimo, ativo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          String(p.id),
          organizacaoId,
          String(p.nome ?? 'Sem nome'),
          String(p.categoria ?? ''),
          String(p.marca ?? ''),
          String(p.codigoBarras ?? ''),
          dinheiro(p.custo),
          dinheiro(p.venda),
          inteiro(p.qtd),
          inteiro(p.min) || 2,
          p.ativo !== false
        ]
      );
    }

    for (const s of listas.servicos) {
      await tx.query('INSERT INTO servicos (id, organizacao_id, nome, valor, pecas, ativo) VALUES ($1,$2,$3,$4,$5,$6)', [
        String(s.id),
        organizacaoId,
        String(s.nome ?? 'Sem nome'),
        dinheiro(s.valor),
        JSON.stringify(s.pecas ?? []),
        s.ativo !== false
      ]);
    }

    for (const f of listas.fornecedores) {
      await tx.query('INSERT INTO fornecedores (id, organizacao_id, nome, cnpj, tel, vendedor, obs, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
        String(f.id),
        organizacaoId,
        String(f.nome ?? 'Sem nome'),
        String(f.cnpj ?? ''),
        String(f.tel ?? ''),
        String(f.vendedor ?? ''),
        String(f.obs ?? ''),
        f.ativo !== false
      ]);
    }

    const clientesValidos = new Set(listas.clientes.map((c) => String(c.id)));
    const gravarOrdem = async (o, tipo) => {
      // Uma OS órfã (cliente ausente no backup) violaria a chave estrangeira.
      if (!clientesValidos.has(String(o.clienteId))) return;
      await tx.query(
        `INSERT INTO ordens (id, organizacao_id, cliente_id, tipo, data, itens, valor_total, status, estoque_debitado, valor_pago, tempo_gasto)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          String(o.id),
          organizacaoId,
          String(o.clienteId),
          tipo,
          o.data ? new Date(o.data) : new Date(),
          JSON.stringify(o.itens ?? []),
          dinheiro(o.valorTotal),
          STATUS_VALIDOS.includes(o.status) ? o.status : 'Pendente',
          Boolean(o.estoqueDebitado),
          dinheiro(o.valorPago),
          inteiro(o.tempoGasto)
        ]
      );
    };

    for (const o of listas.os) await gravarOrdem(o, 'os');
    for (const o of listas.orcamentos) await gravarOrdem(o, 'orcamento');

    for (const t of listas.transacoes) {
      await tx.query(
        `INSERT INTO transacoes (id, organizacao_id, descricao, valor, tipo, data, cliente_nome, origem_detalhada, origem, itens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          String(t.id),
          organizacaoId,
          String(t.desc ?? 'Sem descrição'),
          dinheiro(t.valor),
          t.tipo === 'entrada' ? 'entrada' : 'saida',
          t.data ? new Date(t.data) : new Date(),
          String(t.clienteNome ?? 'Avulso'),
          String(t.origemDetalhada ?? ''),
          t.origem ?? null,
          t.itens ? JSON.stringify(t.itens) : null
        ]
      );
    }

    const total = Object.values(listas).reduce((acc, l) => acc + l.length, 0);
    return { total };
  });
}

/* ------------------------------ nota fiscal -------------------------------- */

export function entradaPorNota({ fornecedor, cnpj, numero, total, itens, cadastrarFornecedor, margem }, organizacaoId) {
  const selecionados = (itens ?? []).filter((i) => i?.nome);
  if (!selecionados.length) throw erro(400, 'Nenhum item selecionado.');

  const nomeFornecedor = String(fornecedor ?? '').trim() || 'Fornecedor não informado';
  const multiplicador = 1 + Math.max(0, Number(margem ?? 60)) / 100;

  return transacao(async (tx) => {
    const aplicados = [];

    for (const item of selecionados) {
      const qtd = inteiro(item.qtd, 1) || 1;
      const custo = dinheiro(item.custo ?? item.valorUnitario);

      if (item.produtoId) {
        const { rows } = await tx.query('SELECT nome, qtd FROM produtos WHERE id = $1 AND organizacao_id = $2 FOR UPDATE', [
          item.produtoId,
          organizacaoId
        ]);
        if (!rows[0]) throw erro(400, 'Peça vinculada não existe mais.');
        await tx.query('UPDATE produtos SET qtd = qtd + $1, custo = CASE WHEN $2 > 0 THEN $2 ELSE custo END WHERE id = $3 AND organizacao_id = $4', [
          qtd,
          custo,
          item.produtoId,
          organizacaoId
        ]);
        aplicados.push({ nome: rows[0].nome, qtd, novo: false });
      } else {
        await tx.query(`INSERT INTO produtos (id, organizacao_id, nome, custo, venda, qtd, minimo) VALUES ($1, $2, $3, $4, $5, $6, 2)`, [
          novoId(),
          organizacaoId,
          item.nome,
          custo,
          dinheiro(custo * multiplicador),
          qtd
        ]);
        aplicados.push({ nome: item.nome, qtd, novo: true });
      }
    }

    if (cadastrarFornecedor) {
      const { rows } = await tx.query('SELECT id FROM fornecedores WHERE organizacao_id = $1 AND lower(nome) = lower($2) AND ativo = TRUE', [
        organizacaoId,
        nomeFornecedor
      ]);
      if (!rows[0]) {
        await tx.query('INSERT INTO fornecedores (id, organizacao_id, nome, cnpj, obs) VALUES ($1, $2, $3, $4, $5)', [
          novoId(),
          organizacaoId,
          nomeFornecedor,
          String(cnpj ?? ''),
          `Cadastrado pela leitura da nota ${numero ?? ''}`.trim()
        ]);
      }
    }

    // Uma despesa só, com o total da nota: lançar item a item cobraria a mesma
    // compra várias vezes no caixa.
    const valorNota = dinheiro(total);
    if (valorNota > 0) {
      await lancar(tx, organizacaoId, {
        desc: `Compra de peças: ${nomeFornecedor}`,
        valor: valorNota,
        tipo: 'saida',
        clienteNome: nomeFornecedor,
        origemDetalhada: `Nota ${numero || 's/n'} — ${aplicados.map((a) => `${a.qtd}x ${a.nome}`).join(', ')}`
      });
    }

    return { aplicados };
  });
}
