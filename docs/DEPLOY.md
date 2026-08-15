# Publicar o servidor e gerar o APK

## 1. Servidor no Render

O repositório traz um [`render.yaml`](../render.yaml): o Render lê esse arquivo
e cria o serviço e o banco sozinho.

1. Entre em [dashboard.render.com](https://dashboard.render.com) → **New** →
   **Blueprint**.
2. Aponte para este repositório e confirme.
3. O Render vai pedir dois valores:
   - **`ADMIN_SENHA`** — a senha que você vai usar para entrar no app.
   - **`GEMINI_API_KEY`** — a chave do [Google AI Studio](https://aistudio.google.com/apikey),
     para ler nota fiscal por foto. Pode deixar em branco: o resto do app
     funciona igual, só a leitura da nota fica indisponível.
4. Ao terminar, anote a URL (algo como `https://moto-gear.onrender.com`).

`JWT_SECRET` e a conexão do banco o Render preenche sozinho.

### O que esperar do plano gratuito

- **O serviço dorme** depois de ~15 minutos parado. A primeira tela depois disso
  demora cerca de um minuto para abrir; as seguintes são normais.
- **O banco gratuito expira** e é removido pelo Render depois de um período.

Para uso de verdade na oficina, mude os dois `plan: free` do `render.yaml` para
`starter`. Hoje isso fica em torno de US$ 7/mês cada. É a diferença entre "meu
app demora um minuto para abrir" e "meu app abre", e entre "meu banco some" e
"meu banco fica".

### Conferindo

Abra `https://sua-url.onrender.com` no navegador: a tela de login aparece e o
campo **Servidor** já vem preenchido. Entre com `admin` e a senha que você
definiu, e troque a senha em **Configurações**.

## 2. APK Android

O APK traz a interface embutida e conversa com o servidor pela internet.

### Pelo GitHub (recomendado)

O workflow em `.github/workflows/ci.yml` roda os testes e gera o APK a cada
push. Para ele sair **assinado** (só APK assinado instala no celular), cadastre
no repositório, em *Settings → Secrets and variables → Actions*:

| Onde | Nome | Valor |
|---|---|---|
| Secret | `MOTOGEAR_KEYSTORE_BASE64` | a chave `.keystore` em base64 (`base64 -w0 motogear.keystore`) |
| Secret | `MOTOGEAR_KEYSTORE_SENHA` | a senha da chave |
| Variable | `MOTOGEAR_SERVIDOR` | `https://sua-url.onrender.com` |

Com `MOTOGEAR_SERVIDOR` definida, o app já abre apontando para o seu servidor e
ninguém precisa digitar endereço.

O APK sai em **Actions → a execução → Artifacts → `moto-gear-apk`** (três
arquivos: `arm64-v8a` e `armeabi-v7a` para instalar direto, e o `universal`, que
serve a qualquer aparelho e é o que o app baixa ao se atualizar).

> **Guarde a chave `.keystore` e a senha.** O Android só aceita atualizar um app
> instalado se a nova versão estiver assinada com a mesma chave. Perdeu a chave,
> perdeu a possibilidade de atualizar sem desinstalar (e desinstalar não perde
> dados aqui, porque eles estão no servidor — mas é chato).

### Aviso de "nova versão" dentro do app

A cada push na branch padrão, o CI publica um **release no GitHub** com os APKs e
uma tag `build-N` (N cresce a cada deploy — é o mesmo número do `versionCode` do
Android e do `versao.js` embutido). Quando o app abre, ele compara o build
instalado com o do último release; se houver um mais novo, mostra a faixa
**"Nova versão do app disponível"** com **Atualizar** (abre o download do APK
universal — o Android instala por cima, mantendo os dados) e **Depois**.

Para o release sair **instalável**, a mesma chave de assinatura acima precisa
estar cadastrada (senão os APKs saem sem assinatura). Nada além disso precisa ser
configurado: o release usa o `GITHUB_TOKEN` automático do próprio Actions.

### Na sua máquina

Precisa de JDK 21 e Android SDK (plataforma 35, build-tools 35).

```bash
cd app
npm ci
npm run build:css
MOTOGEAR_SERVIDOR=https://sua-url.onrender.com node scripts/definir-servidor.mjs
npx cap sync android

cd android
MOTOGEAR_KEYSTORE=/caminho/motogear.keystore \
MOTOGEAR_KEYSTORE_SENHA=suasenha \
MOTOGEAR_KEY_ALIAS=motogear \
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

Sem as variáveis da chave, o build funciona mas sai sem assinatura — serve para
verificar que compila, não para instalar.

### Instalando no celular

Transfira o APK e abra. O Android vai pedir permissão para instalar de fonte
desconhecida — é o normal para app fora da Play Store. Requer **Android 8.0 ou
superior** (exigência do leitor de código de barras).

## 3. Trazendo os dados do app antigo

1. No app antigo: **Configurações → Fazer backup completo**. Guarde o arquivo.
2. No novo, logado: **Configurações → Restaurar de um arquivo** e escolha o
   mesmo arquivo.

O formato antigo é aceito direto, inclusive os backups em Base64 das primeiras
versões. Como os dados agora ficam no servidor, restaure **uma vez só** — o
segundo aparelho já vai ver tudo ao entrar.
