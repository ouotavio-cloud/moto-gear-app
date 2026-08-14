/**
 * Grava em `www/servidor.js` o endereço padrão do servidor.
 *
 * O APK não tem uma origem para herdar, então precisa saber de fábrica onde
 * fica a API. Rode antes de `npx cap sync android`:
 *
 *   MOTOGEAR_SERVIDOR=https://sua-oficina.onrender.com node scripts/definir-servidor.mjs
 *
 * Sem a variável, o arquivo volta ao padrão "mesma origem", que é o certo para
 * a versão web servida pelo próprio backend.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(AQUI, '..', 'www', 'servidor.js');

const url = (process.env.MOTOGEAR_SERVIDOR ?? '').trim().replace(/\/+$/, '');

if (url && !/^https?:\/\//.test(url)) {
  console.error(`Endereço inválido: "${url}". Use a URL completa, com https://`);
  process.exit(1);
}

const conteudo = `/**
 * Endereço padrão do servidor.
 *
 * Vazio significa "mesma origem", que é o caso quando a interface é servida
 * pelo próprio backend no navegador. No APK não existe origem para herdar, por
 * isso o build do Android reescreve este arquivo com a URL do Render
 * (script \`app/scripts/definir-servidor.mjs\`). O usuário também pode digitar o
 * endereço na tela de login.
 */
window.MOTOGEAR_SERVIDOR = ${JSON.stringify(url)};
`;

await writeFile(DESTINO, conteudo);
console.log(url ? `Servidor do app definido como ${url}` : 'Servidor do app: mesma origem (web)');
