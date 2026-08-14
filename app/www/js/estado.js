/**
 * Estado compartilhado mínimo entre telas.
 *
 * Existe só para quebrar a dependência circular entre `clientes.js` e `os.js`:
 * os dois precisam saber qual cliente está aberto, mas nenhum deve importar o
 * outro por causa disso.
 */

import { db } from './api.js';

let clienteAtualId = null;

export const clienteAtual = () => clienteAtualId;

export function setClienteAtual(id) {
  clienteAtualId = id;
}

export function nomeCliente(id) {
  return db.clientes.find((c) => c.id === id)?.nome ?? 'Cliente removido';
}
