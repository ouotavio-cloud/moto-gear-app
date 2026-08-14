# Moto Gear App

Aplicativo de gestão para oficinas de motos ("Moto Gear Oficina"), 100% offline,
empacotado como app Android híbrido (Capacitor/WebView).

Este repositório foi criado a partir de engenharia reversa do APK enviado
pelo autor (`com.appteste.demo`), já que o projeto ainda não tinha código
versionado. O conteúdo de `app/www/index.html` é exatamente o que roda dentro
do app instalado no celular — é o código-fonte real, não uma reconstrução.

## Estrutura

```
app/
  capacitor.config.json     # appId, nome do app, pasta web (www)
  capacitor.plugins.json    # plugins nativos usados
  www/
    index.html               # TODO o app: HTML + CSS + JS em um único arquivo
    logo.jpg                 # logo exibido no cabeçalho
docs/
  ARQUITETURA.md            # como o app é construído e persiste dados
  MODELO_DE_DADOS.md        # esquema de cada entidade (produtos, clientes, OS...)
  FUNCIONALIDADES.md        # o que cada tela faz e quais funções JS implementam
```

## Como rodar/editar

O app não tem processo de build (sem `package.json`, sem bundler). É um único
arquivo HTML servido pelo WebView do Capacitor. Para testar mudanças rapidamente
no navegador, basta abrir `app/www/index.html` (algumas APIs nativas, como
compartilhar arquivo, só funcionam dentro do app Android — no navegador cai
no fallback `navigator.share`/download direto, ver `docs/ARQUITETURA.md`).

Para gerar um novo APK, o arquivo `app/www/index.html` (+ `logo.jpg`) precisa
ser reempacotado com o Capacitor/ferramenta que gerou o APK original — este
repositório guarda o código-fonte, não o pipeline de build do APK.

Leia `docs/FUNCIONALIDADES.md` antes de mexer em qualquer tela: lá estão as
regras de negócio que não são óbvias só lendo o HTML (ex.: quando o estoque é
debitado, como pendências financeiras são calculadas).
