/** Entrada do servidor. */

import { conectar, desconectar } from './db.js';
import { garantirAdmin } from './auth.js';
import { criarApp } from './app.js';

const PORTA = Number(process.env.PORT ?? 3000);

async function principal() {
  await conectar();
  await garantirAdmin();

  if (!process.env.DATABASE_URL) {
    console.warn('Atenção: sem DATABASE_URL. Usando banco em memória — os dados somem ao reiniciar.');
  }

  const servidor = criarApp().listen(PORTA, () => console.log(`Moto Gear no ar em http://localhost:${PORTA}`));

  const encerrar = async (sinal) => {
    console.log(`\n${sinal} recebido, encerrando...`);
    servidor.close(async () => {
      await desconectar();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

principal().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
