-- Esquema do Moto Gear.
--
-- Listas aninhadas (peças de um serviço, itens de uma OS) ficam em JSONB: são
-- sempre lidas junto com o registro pai e nunca consultadas isoladamente, então
-- normalizar só traria junções sem ganho.
--
-- Multi-oficina: cada organização é uma oficina isolada das outras. Toda
-- tabela de dados carrega `organizacao_id` e toda consulta filtra por ele —
-- é o que impede uma oficina de ver o estoque, os clientes ou o caixa de outra.

CREATE TABLE IF NOT EXISTS organizacoes (
  id              TEXT PRIMARY KEY,
  nome            TEXT NOT NULL,
  codigo_convite  TEXT UNIQUE NOT NULL,
  pix_chave       TEXT NOT NULL DEFAULT '',
  pix_nome        TEXT NOT NULL DEFAULT '',
  pix_cidade      TEXT NOT NULL DEFAULT '',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bancos criados antes do Pix já têm a tabela `organizacoes` sem estas colunas.
-- `CREATE TABLE IF NOT EXISTS` não as adiciona a uma tabela existente, então os
-- ALTERs abaixo (idempotentes) garantem a coluna nos bancos já em produção.
ALTER TABLE organizacoes ADD COLUMN IF NOT EXISTS pix_chave  TEXT NOT NULL DEFAULT '';
ALTER TABLE organizacoes ADD COLUMN IF NOT EXISTS pix_nome   TEXT NOT NULL DEFAULT '';
ALTER TABLE organizacoes ADD COLUMN IF NOT EXISTS pix_cidade TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS usuarios (
  id              TEXT PRIMARY KEY,
  organizacao_id  TEXT NOT NULL REFERENCES organizacoes(id),
  usuario         TEXT UNIQUE NOT NULL,
  senha_hash      TEXT NOT NULL,
  papel           TEXT NOT NULL DEFAULT 'funcionario' CHECK (papel IN ('chefe', 'funcionario')),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS produtos (
  id             TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  nome           TEXT NOT NULL,
  categoria      TEXT NOT NULL DEFAULT '',
  marca          TEXT NOT NULL DEFAULT '',
  codigo_barras  TEXT NOT NULL DEFAULT '',
  custo          NUMERIC(12,2) NOT NULL DEFAULT 0,
  venda          NUMERIC(12,2) NOT NULL DEFAULT 0,
  qtd            INTEGER NOT NULL DEFAULT 0,
  minimo         INTEGER NOT NULL DEFAULT 2,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servicos (
  id             TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  nome           TEXT NOT NULL,
  valor          NUMERIC(12,2) NOT NULL DEFAULT 0,
  pecas          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS clientes (
  id             TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  nome           TEXT NOT NULL,
  tel            TEXT NOT NULL DEFAULT '',
  placa          TEXT NOT NULL DEFAULT '',
  moto           TEXT NOT NULL DEFAULT '',
  ativo          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id             TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL REFERENCES organizacoes(id),
  nome           TEXT NOT NULL,
  cnpj           TEXT NOT NULL DEFAULT '',
  tel            TEXT NOT NULL DEFAULT '',
  vendedor       TEXT NOT NULL DEFAULT '',
  obs            TEXT NOT NULL DEFAULT '',
  ativo          BOOLEAN NOT NULL DEFAULT TRUE
);

-- OS e orçamento compartilham a mesma estrutura; `tipo` separa os dois.
CREATE TABLE IF NOT EXISTS ordens (
  id                TEXT PRIMARY KEY,
  organizacao_id    TEXT NOT NULL REFERENCES organizacoes(id),
  cliente_id        TEXT NOT NULL REFERENCES clientes(id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('os', 'orcamento')),
  data              TIMESTAMPTZ NOT NULL DEFAULT now(),
  itens             JSONB NOT NULL DEFAULT '[]'::jsonb,
  valor_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'Pendente'
                    CHECK (status IN ('Pendente', 'Andamento', 'Concluída', 'Cancelada')),
  estoque_debitado  BOOLEAN NOT NULL DEFAULT FALSE,
  valor_pago        NUMERIC(12,2) NOT NULL DEFAULT 0,
  tempo_gasto       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transacoes (
  id                TEXT PRIMARY KEY,
  organizacao_id    TEXT NOT NULL REFERENCES organizacoes(id),
  descricao         TEXT NOT NULL,
  valor             NUMERIC(12,2) NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  data              TIMESTAMPTZ NOT NULL DEFAULT now(),
  cliente_nome      TEXT NOT NULL DEFAULT 'Avulso',
  origem_detalhada  TEXT NOT NULL DEFAULT '',
  origem            TEXT,
  itens             JSONB
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ordens_cliente ON ordens (cliente_id);
CREATE INDEX IF NOT EXISTS idx_ordens_tipo_status ON ordens (tipo, status);
CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes (data);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos (codigo_barras);

CREATE INDEX IF NOT EXISTS idx_usuarios_organizacao ON usuarios (organizacao_id);
CREATE INDEX IF NOT EXISTS idx_produtos_organizacao ON produtos (organizacao_id);
CREATE INDEX IF NOT EXISTS idx_servicos_organizacao ON servicos (organizacao_id);
CREATE INDEX IF NOT EXISTS idx_clientes_organizacao ON clientes (organizacao_id);
CREATE INDEX IF NOT EXISTS idx_fornecedores_organizacao ON fornecedores (organizacao_id);
CREATE INDEX IF NOT EXISTS idx_ordens_organizacao ON ordens (organizacao_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_organizacao ON transacoes (organizacao_id);
