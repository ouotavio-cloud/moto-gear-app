# Moto Gear

Sistema de gestão para oficina de motos: estoque, serviços, caixa, clientes,
ordens de serviço, fornecedores e análises.

São duas partes que trabalham juntas:

- **`server/`** — API em Node/Express com Postgres. É a fonte da verdade: todo
  cálculo de estoque, caixa e status de OS acontece aqui, dentro de transação.
- **`app/`** — a interface. Roda no navegador (servida pelo próprio backend) e
  também empacotada como aplicativo Android via Capacitor.

O aparelho não guarda dados da oficina — só o endereço do servidor e o token da
sessão. Trocar de celular é fazer login de novo.

## Começando

```bash
# API (sobe com banco em memória se não houver DATABASE_URL)
cd server && npm install && npm start

# Interface: http://localhost:3000
```

No primeiro boot o servidor cria o usuário inicial e imprime a senha no log
(ou usa `ADMIN_USUARIO`/`ADMIN_SENHA` se você definir).

Para mexer no visual, recompile o CSS depois de alterar classes:

```bash
cd app && npm install && npm run build:css
```

## Testes

```bash
cd server && npm test        # 29 testes de API e regras de negócio
cd app && npx playwright test # 21 testes de ponta a ponta contra o servidor real
```

Os testes da API usam PGlite — o mesmo Postgres compilado para WebAssembly —
então o SQL exercitado é o mesmo que roda em produção, sem precisar de banco
instalado.

## Documentação

| Documento | Para quê |
|---|---|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Como as peças se encaixam e por quê |
| [`docs/MODELO_DE_DADOS.md`](docs/MODELO_DE_DADOS.md) | Tabelas e formato de cada entidade |
| [`docs/REGRAS_DE_NEGOCIO.md`](docs/REGRAS_DE_NEGOCIO.md) | Quando o estoque sai, o que vira pendência |
| [`docs/API.md`](docs/API.md) | Endpoints |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Publicar no Render e gerar o APK |

## Histórico

A versão 1 era um único `index.html` com os dados guardados no próprio celular.
Ela está preservada em [`legacy/`](legacy/) para consulta. Quem vem dela leva os
dados junto: **Configurações → Backup** no app antigo gera um arquivo que a tela
de **Restaurar** desta versão aceita sem conversão.
