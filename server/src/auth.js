/** Autenticação: senha com scrypt, sessão por JWT e organizações (oficinas). */

import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { query, uma, todas } from './db.js';

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

/* ------------------------------- organizações ------------------------------ */

const gerarCodigoConvite = () => randomBytes(4).toString('hex').toUpperCase();

export async function criarOrganizacao(nome) {
  const id = randomUUID();
  const codigoConvite = gerarCodigoConvite();
  await query('INSERT INTO organizacoes (id, nome, codigo_convite) VALUES ($1, $2, $3)', [id, nome, codigoConvite]);
  return { id, nome, codigoConvite };
}

export async function obterOrganizacao(organizacaoId) {
  return uma('SELECT nome, codigo_convite, pix_chave, pix_nome, pix_cidade FROM organizacoes WHERE id = $1', [organizacaoId]);
}

/** Só o chefe chama isto: o código antigo vira inválido na hora. */
export async function regenerarCodigoConvite(organizacaoId) {
  const codigoConvite = gerarCodigoConvite();
  await query('UPDATE organizacoes SET codigo_convite = $1 WHERE id = $2', [codigoConvite, organizacaoId]);
  return codigoConvite;
}

/**
 * Configuração do Pix da oficina (chave, nome do recebedor e cidade). É o que o
 * app usa para montar o "copia e cola" e o QR Code no valor de cada venda. Só o
 * chefe altera. Nome e cidade entram no BR Code do Pix, que só aceita ASCII
 * maiúsculo — a limpeza real acontece na hora de montar o código, no app.
 */
export async function salvarPix(organizacaoId, { chave, nome, cidade }) {
  await query('UPDATE organizacoes SET pix_chave = $1, pix_nome = $2, pix_cidade = $3 WHERE id = $4', [
    String(chave ?? '').trim(),
    String(nome ?? '').trim(),
    String(cidade ?? '').trim(),
    organizacaoId
  ]);
  return obterOrganizacao(organizacaoId);
}

/* --------------------------------- usuários -------------------------------- */

export async function criarUsuario(usuario, senha, organizacaoId, papel = 'funcionario') {
  const id = randomUUID();
  await query('INSERT INTO usuarios (id, organizacao_id, usuario, senha_hash, papel) VALUES ($1, $2, $3, $4, $5)', [
    id,
    organizacaoId,
    usuario,
    await gerarHash(senha),
    papel
  ]);
  return { id, usuario, organizacaoId, papel };
}

function validarUsuarioSenha(usuario, senha) {
  const nome = String(usuario ?? '').trim();
  if (nome.length < 3) throw Object.assign(new Error('O usuário precisa ter ao menos 3 caracteres.'), { status: 400 });
  if (String(senha ?? '').length < 6) throw Object.assign(new Error('A senha precisa ter ao menos 6 caracteres.'), { status: 400 });
  return nome;
}

async function garantirUsuarioLivre(nome) {
  const existente = await uma('SELECT id FROM usuarios WHERE usuario = $1', [nome]);
  if (existente) throw Object.assign(new Error('Esse nome de usuário já está em uso.'), { status: 409 });
}

/** Auto-cadastro de uma oficina nova: quem cadastra vira o chefe dela. */
export async function cadastrarChefe(usuario, senha, nomeOficina) {
  const nome = validarUsuarioSenha(usuario, senha);
  const nomeOrg = String(nomeOficina ?? '').trim();
  if (!nomeOrg) throw Object.assign(new Error('Informe o nome da oficina.'), { status: 400 });

  await garantirUsuarioLivre(nome);
  const organizacao = await criarOrganizacao(nomeOrg);
  return criarUsuario(nome, senha, organizacao.id, 'chefe');
}

/** Auto-cadastro de um funcionário: entra na oficina dona do código de convite. */
export async function cadastrarFuncionario(usuario, senha, codigoConvite) {
  const nome = validarUsuarioSenha(usuario, senha);
  const codigo = String(codigoConvite ?? '').trim().toUpperCase();
  if (!codigo) throw Object.assign(new Error('Informe o código de convite da oficina.'), { status: 400 });

  const organizacao = await uma('SELECT id FROM organizacoes WHERE codigo_convite = $1', [codigo]);
  if (!organizacao) throw Object.assign(new Error('Código de convite inválido.'), { status: 404 });

  await garantirUsuarioLivre(nome);
  return criarUsuario(nome, senha, organizacao.id, 'funcionario');
}

export const listarUsuarios = (organizacaoId) =>
  todas('SELECT usuario, papel, criado_em FROM usuarios WHERE organizacao_id = $1 ORDER BY criado_em', [organizacaoId]);

/**
 * Cria a primeira oficina e o primeiro usuário no boot. A senha vem de
 * ADMIN_SENHA; sem ela, é sorteada e impressa uma única vez no log do deploy.
 */
export async function garantirAdmin() {
  const existente = await uma('SELECT id FROM usuarios LIMIT 1');
  if (existente) return null;

  const usuario = process.env.ADMIN_USUARIO || 'admin';
  const senha = process.env.ADMIN_SENHA || randomBytes(6).toString('base64url');
  const organizacao = await criarOrganizacao(process.env.ADMIN_OFICINA || 'Minha Oficina');
  await criarUsuario(usuario, senha, organizacao.id, 'chefe');

  if (!process.env.ADMIN_SENHA) {
    console.log('='.repeat(58));
    console.log(`Usuário inicial criado: ${usuario}`);
    console.log(`Senha (aparece só desta vez): ${senha}`);
    console.log(`Código de convite da oficina: ${organizacao.codigoConvite}`);
    console.log('Defina ADMIN_SENHA nas variáveis de ambiente para fixar a sua.');
    console.log('='.repeat(58));
  }
  return { usuario, senha };
}

export async function autenticar(usuario, senha) {
  const registro = await uma('SELECT id, usuario, senha_hash, organizacao_id, papel FROM usuarios WHERE usuario = $1', [usuario]);
  if (!registro) return null;
  if (!(await conferirSenha(senha, registro.senha_hash))) return null;
  return {
    token: jwt.sign(
      { sub: registro.id, usuario: registro.usuario, organizacaoId: registro.organizacao_id, papel: registro.papel },
      segredo(),
      { expiresIn: VALIDADE }
    )
  };
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

/** Middleware: só deixa passar quem é chefe da oficina. */
export function exigirChefe(req, res, next) {
  if (req.usuario.papel !== 'chefe') return res.status(403).json({ erro: 'Só o chefe da oficina pode fazer isso.' });
  next();
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
