/**
 * Backup e restauração.
 *
 * O backup é gerado pelo servidor e baixado como arquivo; a restauração manda o
 * arquivo de volta e substitui os dados. Serve tanto para guardar uma cópia
 * fora do servidor quanto para trazer os dados do app antigo (formato v1).
 */

import { req, acao } from './api.js';
import { showToast, fecharModal, carregando, pararCarregando } from './ui.js';
import { baixarOuCompartilhar, lerTexto } from './files.js';

export async function fazerBackup() {
  carregando('Gerando backup...');
  try {
    const dados = await req('GET', '/backup');
    await baixarOuCompartilhar(
      `motogear_backup_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(dados),
      'application/json'
    );
    fecharModal('modal-config');
    showToast('Backup gerado!');
  } catch (err) {
    showToast(err.message);
  } finally {
    pararCarregando();
  }
}

/** Aceita o JSON atual e também o backup em Base64 gerado pela versão 1 do app. */
function interpretar(conteudo) {
  const texto = conteudo.trim();
  const json = texto.startsWith('{') ? texto : decodeURIComponent(escape(atob(texto)));
  return JSON.parse(json);
}

export async function restaurarBackup(evento) {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';
  if (!arquivo) return;

  if (!confirm('Isso substitui TODOS os dados do servidor pelos do arquivo. Continuar?')) return;

  let dados;
  try {
    dados = interpretar(await lerTexto(arquivo));
  } catch (err) {
    console.error('Arquivo inválido', err);
    return showToast('Arquivo inválido ou corrompido!');
  }

  const { ok, resultado } = await acao(req('POST', '/restaurar', dados), null, 'Restaurando...');
  if (ok) {
    fecharModal('modal-config');
    showToast(`Restaurado: ${resultado.total} registro(s).`);
  }
}
