/** Autenticação: senha com scrypt e sessão por JWT. */

import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { query, uma } from './db.js';

const scrypt = promisify(scryptCb);
const VALIDADE = '30d';

export function segredo() {
  const valor = process.env.JWT_SECRET;
  if (valor) return valor;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET é obrigatório em produção.');
  }
  // Fora de produção um segredo efêmero basta: derruba as sessões a cada boot,
  // que é o comportamento desejável em teste/desenvolvimento.
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  return process.env.JWT_SECRET;
}

export async function gerarHash(senha) {
  const sal = randomBytes(16).toString('hex');
  const derivada = await scrypt(senha, sal, 64);
  return `${sal}:${derivada.toString('hex')}`;
}

export async function conferirSenha(senha, hashArmazenado) {
  const [sal, esperado] = String(hashArmazenado).split(':');
  if (!sal || !esperado) return false;
  const derivada = await scrypt(senha, sal, 64);
  const esperadoBuf = Buffer.from(esperado, 'hex');
  return derivada.length === esperadoBuf.length && timingSafeEqual(derivada, esperadoBuf);
}

export async function criarUsuario(usuario, senha) {
  const id = randomUUID();
  await query('INSERT INTO usuarios (id, usuario, senha_hash) VALUES ($1, $2, $3)', [id, usuario, await gerarHash(senha)]);
  return { id, usuario };
}

/** Auto-cadastro: qualquer pessoa com o endereço do servidor pode criar sua conta. */
export async function cadastrarUsuario(usuario, senha) {
  const nome = String(usuario ?? '').trim();
  if (nome.length < 3) throw Object.assign(new Error('O usuário precisa ter ao menos 3 caracteres.'), { status: 400 });
  if (String(senha ?? '').length < 6) throw Object.assign(new Error('A senha precisa ter ao menos 6 caracteres.'), { status: 400 });

  const existente = await uma('SELECT id FROM usuarios WHERE usuario = $1', [nome]);
  if (existente) throw Object.assign(new Error('Esse nome de usuário já está em uso.'), { status: 409 });

  return criarUsuario(nome, senha);
}

/**
 * Cria o primeiro usuário no boot. A senha vem de ADMIN_SENHA; sem ela, é
 * sorteada e impressa uma única vez no log do deploy.
 */
export async function garantirAdmin() {
  const existente = await uma('SELECT id FROM usuarios LIMIT 1');
  if (existente) return null;

  const usuario = process.env.ADMIN_USUARIO || 'admin';
  const senha = process.env.ADMIN_SENHA || randomBytes(6).toString('base64url');
  await criarUsuario(usuario, senha);

  if (!process.env.ADMIN_SENHA) {
    console.log('='.repeat(58));
    console.log(`Usuário inicial criado: ${usuario}`);
    console.log(`Senha (aparece só desta vez): ${senha}`);
    console.log('Defina ADMIN_SENHA nas variáveis de ambiente para fixar a sua.');
    console.log('='.repeat(58));
  }
  return { usuario, senha };
}

export async function autenticar(usuario, senha) {
  const registro = await uma('SELECT id, usuario, senha_hash FROM usuarios WHERE usuario = $1', [usuario]);
  if (!registro) return null;
  if (!(await conferirSenha(senha, registro.senha_hash))) return null;
  return { token: jwt.sign({ sub: registro.id, usuario: registro.usuario }, segredo(), { expiresIn: VALIDADE }) };
}

/** Middleware: exige `Authorization: Bearer <token>`. */
export function exigirLogin(req, res, next) {
  const cabecalho = req.headers.authorization ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Faça login para continuar.' });

  try {
    req.usuario = jwt.verify(token, segredo());
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  }
}

export async function trocarSenha(usuarioId, senhaAtual, senhaNova) {
  const registro = await uma('SELECT senha_hash FROM usuarios WHERE id = $1', [usuarioId]);
  if (!registro) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
  if (!(await conferirSenha(senhaAtual, registro.senha_hash))) {
    throw Object.assign(new Error('Senha atual incorreta.'), { status: 400 });
  }
  if (String(senhaNova).length < 6) {
    throw Object.assign(new Error('A nova senha precisa ter ao menos 6 caracteres.'), { status: 400 });
  }
  await query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [await gerarHash(senhaNova), usuarioId]);
}
