/**
 * Grava em `www/servidor.js` o endereço padrão do servidor e, quando há URL,
 * configura o Capacitor para carregar a interface direto do servidor.
 *
 * Com `server.url` no Capacitor, o WebView busca o HTML/JS/CSS do Render em
 * vez de usar os arquivos embutidos no APK. Resultado: o app atualiza sozinho
 * sempre que o servidor é redeployado, sem precisar gerar um APK novo.
 *
 *   MOTOGEAR_SERVIDOR=https://sua-oficina.onrender.com node scripts/definir-servidor.mjs
 *
 * Sem a variável, o arquivo volta ao padrão "mesma origem" e o Capacitor
 * carrega do pacote local (comportamento normal para dev/web).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO_JS = join(AQUI, '..', 'www', 'servidor.js');
const DESTINO_CAP = join(AQUI, '..', 'capacitor.config.json');

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

await writeFile(DESTINO_JS, conteudo);
console.log(url ? `Servidor do app definido como ${url}` : 'Servidor do app: mesma origem (web)');

const capConfig = JSON.parse(await readFile(DESTINO_CAP, 'utf8'));

if (url) {
  capConfig.server = { url, cleartext: false };
} else {
  delete capConfig.server;
}

await writeFile(DESTINO_CAP, JSON.stringify(capConfig, null, '\t') + '\n');
console.log(url ? `Capacitor: WebView carrega de ${url}` : 'Capacitor: WebView carrega do pacote local');
