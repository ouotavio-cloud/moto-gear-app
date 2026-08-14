# Arquitetura

## Visão geral

O Moto Gear App **não tem backend**. É um SPA (single page app) em JavaScript
puro, embrulhado pelo [Capacitor](https://capacitorjs.com/) para virar um app
Android instalável. Todo o app — HTML, CSS e JS — vive em um único arquivo:
`app/www/index.html` (~1240 linhas).

- **appId**: `com.appteste.demo`
- **appName**: `MOTO GEAR APP`
- **webDir**: `www` (é isso que o Capacitor empacota dentro do APK)

## Stack

| Camada | Tecnologia | Como é carregado |
|---|---|---|
| UI/estilo | Tailwind CSS | CDN (`cdn.tailwindcss.com`) — sem build step, config inline no `<script>` |
| Ícones | Font Awesome 6 | CDN (`cdnjs.cloudflare.com`) |
| Import de planilha | SheetJS (`xlsx`) | CDN (`cdn.jsdelivr.net`) |
| Shell nativo | Capacitor | `capacitor-bridge-bundle.js` (empacotado no APK) |
| Lógica do app | JavaScript vanilla | inline, dentro do próprio `index.html` |

Como CSS/ícones/xlsx vêm de CDN, **o app precisa de internet ao menos no
primeiro carregamento** (o WebView do Android cacheia depois). Isso explica a
permissão `android.permission.INTERNET` no `AndroidManifest.xml` — é a única
permissão de rede do app; não existe nenhuma chamada a API/servidor próprio.

## Plugins nativos (Capacitor)

Declarados em `app/capacitor.plugins.json`:

- **`@capacitor/preferences`** — armazenamento nativo chave/valor (persistência principal no Android)
- **`@capacitor/filesystem`** — grava arquivos temporários (backup/CSV) na pasta de cache do app
- **`@capacitor/share`** — abre o menu nativo de compartilhamento para exportar backup/CSV

## Persistência de dados (o coração do app)

Não existe banco de dados remoto. Cada "tabela" de `db` (ver
`docs/MODELO_DE_DADOS.md`) é salva **em triplicado**, por robustez, via
`saveDB(key)`:

1. `CapacitorPreferences` (nativo, só existe rodando como app Android)
2. `localStorage` (sempre disponível, inclusive no navegador)
3. `IndexedDB` (banco `MotoGearDB`, object store `store`)

Na leitura (`loadDB()`), a ordem de prioridade é a mesma: tenta
`CapacitorPreferences` → `localStorage` → `IndexedDB`, usando o primeiro valor
não vazio encontrado, e sempre re-sincroniza o `localStorage` com o que achou.

Cada chave é prefixada com `motogear_` (ex.: `motogear_produtos`,
`motogear_transacoes`).

**Por quê assim:** o app roda tanto dentro do WebView Android (onde
`CapacitorPreferences` é confiável) quanto pode ser aberto direto num
navegador para teste (onde só `localStorage`/`IndexedDB` existem). A
redundância evita perda de dados se uma das três camadas falhar ou não
existir no ambiente.

## Backup / Restauração

- **Backup** (`fazerBackup()`): serializa todas as 7 entidades em um único
  JSON e chama `baixarOuCompartilhar()`.
- **Restauração** (`restaurarBackup()`): lê um arquivo `.json`/`.motogear`/`.txt`,
  substitui os dados atuais. Também aceita o **formato legado em Base64**
  (versões antigas do app codificavam o backup com `atob`), detectado quando o
  conteúdo não começa com `{`.

## Compartilhar/baixar arquivo (`baixarOuCompartilhar`)

Função central usada tanto pelo backup quanto pela exportação CSV do caixa:

1. Se `CapacitorFilesystem`/`CapacitorShare` existem (rodando no Android):
   grava o arquivo em `Directory.Cache` e abre o menu nativo de
   compartilhar/salvar.
2. Senão, tenta a Web Share API (`navigator.share`) com o arquivo.
3. Senão, cai para download direto via link `<a download>` (navegador desktop).

## Sem processo de build

Não há `package.json`, bundler ou transpilação. Editar o app é editar
`app/www/index.html` diretamente. Isso é intencional na forma como o app foi
originalmente gerado (provavelmente por uma ferramenta no-code/app-builder que
empacota HTML puro com Capacitor) — qualquer refatoração para um projeto
Capacitor "completo" (com `npm`, `npx cap sync`, etc.) é uma decisão a ser
tomada conscientemente, não algo já em andamento.
