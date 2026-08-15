/**
 * Versão instalada do app.
 *
 * `MOTOGEAR_BUILD` é um número que só cresce a cada deploy (o mesmo do
 * `versionCode` do Android); é ele que o app compara com o último release no
 * GitHub para saber se há atualização. `MOTOGEAR_VERSAO` é só o rótulo mostrado
 * ao usuário. O build do Android reescreve este arquivo (script
 * `app/scripts/carimbar-versao.mjs`); no navegador/dev ele fica no padrão
 * abaixo, e a checagem de atualização nem roda (só faz sentido no APK).
 */
window.MOTOGEAR_BUILD = 0;
window.MOTOGEAR_VERSAO = "dev";
