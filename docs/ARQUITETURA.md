# Arquitetura

## O desenho em uma frase

Um servidor Node com Postgres guarda e calcula tudo; a mesma interface web é
servida por ele no navegador e empacotada num APK Android.

```
┌─────────────────┐        HTTPS + JWT        ┌──────────────────────┐
│  APK Android    │ ────────────────────────► │                      │
│  (WebView)      │                           │   server/ (Express)  │
└─────────────────┘                           │                      │
                                              │  · regras de negócio │
┌─────────────────┐        mesma origem       │  · leitura de nota   │
│  Navegador      │ ────────────────────────► │  · serve a interface │
└─────────────────┘                           └──────────┬───────────┘
                                                         │ SQL
                                                  ┌──────▼───────┐
                                                  │  Postgres    │
                                                  └──────────────┘
```

## Por que as regras vivem no servidor

Na versão 1 o celular calculava tudo. Isso funciona com uma pessoa usando um
aparelho e quebra na hora que aparece a segunda: dois celulares vendendo a
última peça ao mesmo tempo dariam baixa duas vezes, e o estoque ficaria
negativo sem ninguém perceber.

Agora, toda operação que mexe em estoque ou caixa roda dentro de uma transação
de banco, com `SELECT ... FOR UPDATE` nas peças envolvidas. Quem chegar em
segundo lugar espera e recebe um "estoque insuficiente" honesto em vez de furar
o controle.

O app manda intenção (`vender 3 desta peça`), nunca resultado (`o estoque agora
é 5`). Os preços também são lidos do banco na hora de fechar a conta — o que a
tela mostra é conveniência, não a fonte do valor cobrado.

## As partes

### `server/src`

| Arquivo | Responsabilidade |
|---|---|
| `index.js` | Sobe o servidor, conecta o banco, cria o usuário inicial |
| `app.js` | Monta o Express: `/api` e os arquivos da interface |
| `db.js` | Conexão e migração. Postgres em produção, PGlite em teste |
| `schema.sql` | As tabelas |
| `auth.js` | Senha com scrypt e sessão por JWT |
| `negocio.js` | Regras: estoque, vendas, OS, nota fiscal, backup |
| `cadastros.js` | CRUD de peças, serviços, clientes e fornecedores |
| `mapeadores.js` | Linha do banco → formato que o app consome |
| `ia.js` | Leitura da foto da nota fiscal |
| `rotas.js` | Endpoints |

### `app/www/js`

| Arquivo | Responsabilidade |
|---|---|
| `api.js` | Cliente HTTP, sessão e o espelho `db` do estado do servidor |
| `main.js` | Login, registro dos renderizadores, `window.App` |
| `ui.js` | Toast, modais, navegação, formatação |
| `estoque.js`, `servicos.js`, `caixa.js`, `clientes.js`, `os.js`, `fornecedores.js` | Uma tela cada |
| `dashboard.js`, `analises.js` | Telas só de leitura, calculadas do espelho |
| `notafiscal.js` | Foto → conferência → entrada no estoque |
| `barcode.js` | Leitor de código de barras |
| `importar.js`, `backup.js` | Planilha e backup |
| `files.js` | Compartilhar/baixar arquivo e comprimir imagem |

O HTML chama as funções por `App.algumaCoisa()`; `main.js` é quem publica esse
objeto. Assim os `onclick` continuam legíveis e as funções seguem em módulos.

### Fluxo de uma operação

1. A tela chama `req('POST', '/vendas', { ... })`.
2. O servidor valida, aplica dentro de uma transação e responde.
3. `acao()` recarrega `GET /estado` e redesenha tudo.

Recarregar o estado inteiro depois de cada escrita é deliberado: o volume de uma
oficina é pequeno (alguns milhares de registros no pior caso) e isso elimina a
classe inteira de bugs em que uma tela mostra um número velho.

## Sessão e segurança

- Senha guardada com **scrypt** e sal por usuário.
- Sessão por **JWT** de 30 dias no cabeçalho `Authorization`. Como não é cookie,
  não existe superfície para requisição forjada de outro site — por isso o CORS
  pode ser liberado para a origem do app Android.
- A **chave da IA fica no servidor**. Se viajasse dentro do APK, qualquer pessoa
  poderia extraí-la do arquivo e gastar a cota da oficina.
- O backup **não inclui** credenciais: ele costuma circular por WhatsApp.

## Interface sem etapa de build

A interface não usa bundler. São módulos ES carregados direto pelo navegador,
com Tailwind compilado uma vez para `www/css/app.css` e as bibliotecas de
terceiros (ícones e leitor de planilha) copiadas em `www/vendor/`.

Isso é escolha, não preguiça: nada de CDN em runtime (o app abre igual com
internet ruim), nada de `node_modules` no APK, e qualquer pessoa consegue abrir
um arquivo e entender o que ele faz sem atravessar uma cadeia de build.

O preço é não ter checagem de tipos nem minificação. Para o tamanho deste
projeto, é troca vantajosa.

## O que muda quando não tem internet

O app **precisa de conexão**. É a consequência aceita ao mover a verdade para o
servidor: os dados ficam a salvo de perder o celular e podem ser abertos de
qualquer aparelho, mas sem rede o app não abre. Se um dia isso incomodar, o
caminho é cache de leitura no aparelho com fila de escrita — trabalho real, com
conflitos para resolver, e por isso não foi feito por antecipação.
