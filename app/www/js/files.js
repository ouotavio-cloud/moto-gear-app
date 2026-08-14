/**
 * Saída de arquivos (backup, CSV) e ponte com os plugins nativos do Capacitor.
 *
 * No Android grava em cache e abre o menu nativo de compartilhar; no navegador
 * cai para a Web Share API e, por último, para download direto.
 */

// Valores dos enums do @capacitor/filesystem. Como o app roda sem bundler, os
// plugins são acessados por `Capacitor.Plugins` e os enums viram string literal.
const DIRECTORY_CACHE = 'CACHE';
const ENCODING_UTF8 = 'utf8';

export function plugin(name) {
  return globalThis.Capacitor?.Plugins?.[name] ?? null;
}

export function isNativo() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

function downloadDireto(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function baixarOuCompartilhar(filename, conteudo, mimeType) {
  const filesystem = plugin('Filesystem');
  const share = plugin('Share');

  if (filesystem && share) {
    try {
      const { uri } = await filesystem.writeFile({
        path: filename,
        data: conteudo,
        directory: DIRECTORY_CACHE,
        encoding: ENCODING_UTF8
      });
      await share.share({ title: filename, url: uri, dialogTitle: `Compartilhar ou salvar ${filename}` });
      return;
    } catch (err) {
      console.error('Compartilhamento nativo falhou, usando fallback', err);
    }
  }

  const blob = new Blob([conteudo], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: filename, files: [file] });
      return;
    } catch (err) {
      console.error('Web Share falhou, usando download direto', err);
    }
  }

  downloadDireto(blob, filename);
}

/** Lê um File como texto. */
export function lerTexto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    reader.readAsText(file);
  });
}

/** Lê um File como ArrayBuffer (planilhas). */
export function lerBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Reduz a foto antes de mandar para a IA: a nota é legível bem antes dos
 * megapixels da câmera, e imagem menor significa resposta mais rápida e barata.
 */
export function comprimirImagem(file, maxLado = 1600, qualidade = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler a imagem'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', qualidade);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
