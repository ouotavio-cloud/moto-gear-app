/**
 * Aviso de nova versão do app.
 *
 * A interface fica embutida no APK, então "atualizar" é instalar um APK novo.
 * Cada deploy publica um release no GitHub com um número de build maior. Aqui o
 * app compara o build instalado (carimbado em `versao.js`) com o do último
 * release; se houver um mais novo, mostra a faixa "nova versão" com o botão
 * Atualizar (abre o download do APK — o Android cuida da instalação) e Depois.
 *
 * Só roda no APK; no navegador a atualização é só recarregar a página, então
 * `main.js` nem chama a checagem fora do Android.
 */

import { plugin } from './files.js';
import { el } from './ui.js';

const REPO = 'ouotavio-cloud/moto-gear-app';

/** Número de build instalado (0 em dev/navegador). */
export function buildInstalado() {
  return Number(globalThis.MOTOGEAR_BUILD) || 0;
}

/** Extrai o número de build de uma tag como "build-42" ou "v2.0.42". */
export function buildDoTag(tag) {
  const casou = String(tag ?? '').match(/(\d+)\s*$/);
  return casou ? Number(casou[1]) : 0;
}

/** Escolhe o APK a baixar: o universal instala em qualquer aparelho. */
export function escolherApk(assets) {
  const apks = (assets ?? []).filter((a) => /\.apk$/i.test(a?.name ?? ''));
  return apks.find((a) => /universal/i.test(a.name)) ?? apks[0] ?? null;
}

async function ultimoRelease() {
  const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }
  });
  if (!resp.ok) return null; // 404 = ainda não há release publicado
  return resp.json();
}

let urlNovoApk = null;

/**
 * Checa se há versão mais nova e, se houver, mostra a faixa de atualização.
 * Falha em silêncio (sem internet, sem release, etc.): o app segue normal.
 */
export async function verificarAtualizacao() {
  try {
    const release = await ultimoRelease();
    if (!release) return;

    if (buildDoTag(release.tag_name) <= buildInstalado()) return;

    const apk = escolherApk(release.assets);
    if (!apk) return;

    urlNovoApk = apk.browser_download_url;
    mostrarBanner(release.name || release.tag_name);
  } catch (err) {
    console.error('Não consegui verificar atualização', err);
  }
}

function mostrarBanner(versao) {
  const banner = el('banner-atualizacao');
  if (!banner) return;
  const rotulo = el('banner-atualizacao-versao');
  if (rotulo) rotulo.textContent = versao;
  banner.classList.remove('hidden');
}

export function adiarAtualizacao() {
  el('banner-atualizacao')?.classList.add('hidden');
}

/** Abre o download do APK novo; o Android baixa e oferece instalar. */
export async function baixarAtualizacao() {
  if (!urlNovoApk) return;
  const browser = plugin('Browser');
  if (browser) {
    await browser.open({ url: urlNovoApk });
  } else {
    window.open(urlNovoApk, '_blank');
  }
}
