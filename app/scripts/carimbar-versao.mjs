/**
 * Grava em `www/versao.js` o número de build e o rótulo de versão do APK.
 *
 * Rode antes de `npx cap sync android`, com as variáveis definidas pelo CI:
 *
 *   MOTOGEAR_BUILD=42 MOTOGEAR_VERSAO=2.0.42 node scripts/carimbar-versao.mjs
 *
 * `MOTOGEAR_BUILD` precisa ser o MESMO número usado no `versionCode` do Android
 * e na tag do release no GitHub — é a comparação desses três que faz o aviso de
 * "nova versão" funcionar. Sem as variáveis, volta ao padrão de dev (build 0).
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(AQUI, '..', 'www', 'versao.js');

const build = Number.parseInt(process.env.MOTOGEAR_BUILD ?? '', 10);
const buildFinal = Number.isFinite(build) && build > 0 ? build : 0;
const versao = (process.env.MOTOGEAR_VERSAO ?? '').trim() || 'dev';

const conteudo = `/**
 * Versão instalada do app.
 *
 * \`MOTOGEAR_BUILD\` é um número que só cresce a cada deploy (o mesmo do
 * \`versionCode\` do Android); é ele que o app compara com o último release no
 * GitHub para saber se há atualização. \`MOTOGEAR_VERSAO\` é só o rótulo mostrado
 * ao usuário. O build do Android reescreve este arquivo (script
 * \`app/scripts/carimbar-versao.mjs\`); no navegador/dev ele fica no padrão
 * abaixo, e a checagem de atualização nem roda (só faz sentido no APK).
 */
window.MOTOGEAR_BUILD = ${buildFinal};
window.MOTOGEAR_VERSAO = ${JSON.stringify(versao)};
`;

await writeFile(DESTINO, conteudo);
console.log(`Versão do app carimbada: build ${buildFinal} (${versao})`);
