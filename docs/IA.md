# Gateway de IA e Ajudante Moto Gear

## Responsabilidades

- **Gemini:** leitura principal das imagens de notas fiscais.
- **Cloudflare Workers AI:** fallback multimodal das notas e fallback do chat.
- **Groq:** conversa principal do ajudante e transcrição com Whisper.
- **Ajuda local:** responde dúvidas frequentes quando nenhum provedor está disponível.

As chaves existem somente no servidor. O APK chama `/api/assistente/*` e
`/api/nota-fiscal/*`, sem conhecer credenciais externas.

## Variáveis opcionais

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=
GROQ_CHAT_MODEL=openai/gpt-oss-20b
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_VISION_MODEL=@cf/qwen/qwen3.8-27b
CLOUDFLARE_CHAT_MODEL=@cf/qwen/qwen3.8-27b
ASSISTANT_GEMINI_FALLBACK=false
IA_TIMEOUT_MS=35000
```

`ASSISTANT_GEMINI_FALLBACK` fica desligado por padrão para reservar a cota do
Gemini às notas. Ative somente se também quiser usá-lo como terceiro provedor
do ajudante.

## Fallback de notas

1. Gemini recebe a imagem.
2. Em `408`, `429`, `5xx` ou timeout, o Cloudflare recebe a mesma imagem.
3. Um circuit breaker evita repetir por alguns segundos um provedor que acabou
   de falhar.
4. O resultado sempre passa pela tela de conferência; nenhuma leitura altera
   estoque ou caixa automaticamente.

Erros da própria entrada, como foto ausente ou ilegível, não provocam tentativas
infinitas em outros provedores.

## Ajudante e rascunhos

O ajudante recebe somente o manual da tela atual e as últimas seis mensagens.
Ele pode preparar rascunhos de produto, serviço, cliente, fornecedor ou despesa.
O cliente abre o formulário correspondente preenchido, mas o botão de salvar
continua dependendo da confirmação humana e das validações normais da API.

## Rotas

- `POST /api/assistente/conversar`
- `POST /api/assistente/transcrever`
- `POST /api/nota-fiscal/ler`
- `GET /api/saude` mostra quais capacidades estão configuradas sem revelar chaves.
