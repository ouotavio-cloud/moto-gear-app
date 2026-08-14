/**
 * Importação de planilha (.xlsx/.xls/.csv).
 *
 * A planilha é lida no aparelho (biblioteca XLSX em `vendor/`) e as linhas
 * reconhecidas vão em lote para o servidor. O tipo de cada linha é deduzido
 * pelas colunas existentes; se não der, cai no nome da aba.
 */

import { req, acao } from './api.js';
import { showToast } from './ui.js';
import { lerBuffer } from './files.js';

const primeiro = (linha, ...chaves) => {
  for (const chave of chaves) {
    const valor = linha[chave];
    if (valor !== undefined && valor !== '') return valor;
  }
  return undefined;
};

const temAlguma = (linha, ...chaves) => chaves.some((c) => c in linha);

function classificar(linha, nomeAba) {
  if (temAlguma(linha, 'placa', 'telefone', 'whatsapp', 'moto', 'modelo moto')) return 'cliente';
  if (
    temAlguma(
      linha,
      'custo',
      'venda',
      'preço custo',
      'preco custo',
      'preço venda',
      'preco venda',
      'categoria',
      'marca',
      'quantidade',
      'qtd',
      'código de barras',
      'codigo de barras'
    )
  )
    return 'produto';
  if (temAlguma(linha, 'valor', 'mão de obra', 'mao de obra', 'valor cobrado')) return 'servico';

  const aba = nomeAba.toLowerCase();
  if (aba.includes('cliente')) return 'cliente';
  if (aba.includes('produto') || aba.includes('peça') || aba.includes('peca') || aba.includes('estoque')) return 'produto';
  if (aba.includes('serviço') || aba.includes('servico')) return 'servico';
  return null;
}

export async function importarPlanilha(evento) {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!arquivo) return;
  if (!globalThis.XLSX) return showToast('Leitor de planilha não carregou.');

  const lote = { produtos: [], clientes: [], servicos: [] };

  try {
    const workbook = XLSX.read(new Uint8Array(await lerBuffer(arquivo)), { type: 'array' });

    for (const nomeAba of workbook.SheetNames) {
      for (const original of XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba])) {
        const linha = {};
        for (const chave of Object.keys(original)) linha[chave.toLowerCase().trim()] = original[chave];

        const nome = primeiro(linha, 'nome', 'descrição', 'descricao');
        if (!nome) continue;

        const tipo = classificar(linha, nomeAba);
        if (tipo === 'cliente') {
          lote.clientes.push({
            nome: String(nome),
            tel: String(primeiro(linha, 'telefone', 'whatsapp') ?? ''),
            placa: String(primeiro(linha, 'placa') ?? ''),
            moto: String(primeiro(linha, 'modelo moto', 'moto', 'modelo') ?? '')
          });
        } else if (tipo === 'produto') {
          lote.produtos.push({
            nome: String(nome),
            categoria: String(primeiro(linha, 'categoria') ?? ''),
            marca: String(primeiro(linha, 'marca') ?? ''),
            codigoBarras: String(primeiro(linha, 'código de barras', 'codigo de barras', 'ean') ?? ''),
            custo: Number(primeiro(linha, 'preço custo', 'preco custo', 'custo')) || 0,
            venda: Number(primeiro(linha, 'preço venda', 'preco venda', 'venda')) || 0,
            qtd: parseInt(primeiro(linha, 'quantidade inicial', 'quantidade', 'qtd'), 10) || 0,
            min: parseInt(primeiro(linha, 'estoque mínimo', 'estoque minimo', 'mínimo', 'minimo'), 10) || 2
          });
        } else if (tipo === 'servico') {
          lote.servicos.push({
            nome: String(nome),
            valor: Number(primeiro(linha, 'valor cobrado', 'valor', 'mão de obra', 'mao de obra')) || 0,
            pecas: []
          });
        }
      }
    }
  } catch (err) {
    console.error('Leitura da planilha falhou', err);
    return showToast('Erro ao ler a planilha: ' + err.message);
  }

  const total = lote.produtos.length + lote.clientes.length + lote.servicos.length;
  if (!total) return showToast('Nenhuma linha reconhecida na planilha.');

  const { ok } = await acao(req('POST', '/importar', lote), null, 'Enviando planilha...');
  if (ok) {
    showToast(`Importado: ${lote.produtos.length} peça(s), ${lote.clientes.length} cliente(s), ${lote.servicos.length} serviço(s).`);
  }
}
