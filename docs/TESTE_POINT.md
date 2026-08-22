# Testar a Point sem a maquininha

Este teste é exclusivo para desenvolvimento. Ele usa o terminal virtual oficial
`NEWLAND_N950__SBX0000001`, não aparece no aplicativo e não acessa o banco, o
caixa nem o estoque do Moto Gear.

1. No Mercado Pago Developers, abra **Suas integrações** e crie ou selecione uma
   aplicação de **Pagamentos presenciais > Mercado Pago Point**.
2. Abra **Dados da integração > Testes > Credenciais de teste** e copie o
   **Access Token** de teste. Não use a Public Key.
3. No GitHub, abra **Settings > Secrets and variables > Actions**.
4. Clique em **New repository secret** e salve:
   - Name: `MERCADO_PAGO_TEST_ACCESS_TOKEN`
   - Secret: o Access Token copiado no passo 2.
5. Abra **Actions > Teste manual - Point virtual > Run workflow**.
6. Abra a execução. O resultado esperado termina com `SUCESSO` em verde.

O segredo não deve ser enviado por chat, salvo em arquivo ou cadastrado no APK.
