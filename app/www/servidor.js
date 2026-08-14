/**
 * Endereço padrão do servidor.
 *
 * Vazio significa "mesma origem", que é o caso quando a interface é servida
 * pelo próprio backend no navegador. No APK não existe origem para herdar, por
 * isso o build do Android reescreve este arquivo com a URL do Render
 * (script `app/scripts/definir-servidor.mjs`). O usuário também pode digitar o
 * endereço na tela de login.
 */
window.MOTOGEAR_SERVIDOR = "";
