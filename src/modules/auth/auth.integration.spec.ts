import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

import { DatabaseModule } from 'src/shared/database/database.module';
import { PrismaService } from 'src/shared/database/prisma.service';
import { UsersModule } from 'src/modules/users/users.module';
import { UsersService } from 'src/modules/users/users.service';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

/**
 * Integração com o Postgres local. Cria os próprios usuários e apaga tudo ao
 * final, sem encostar nos dados de desenvolvimento.
 */
describe('Cadastro e autenticação (integração)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;
  let users: UsersService;
  let jwt: JwtService;

  const EMAIL_DOMAIN = '@auth.xfoods.test';

  const cleanUp = async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: EMAIL_DOMAIN } },
    });
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, UsersModule, AuthModule],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    users = moduleRef.get(UsersService);
    jwt = moduleRef.get(JwtService);

    await cleanUp();
  }, 30000);

  afterAll(async () => {
    await cleanUp();
    await moduleRef.close();
  }, 30000);

  // ---------------------------------------------------------------------------

  let seq = 0;
  const email = () => `cadastro-${(seq += 1)}${EMAIL_DOMAIN}`;

  const cadastrar = (overrides: Record<string, unknown> = {}) =>
    auth.signUp({
      name: 'Dona do Restaurante',
      email: email(),
      password: 'senha-bem-forte',
      ...overrides,
    } as never);

  // ---------------------------------------------------------------------------

  describe('sign-up', () => {
    it('cria a conta e já devolve um token', async () => {
      const resultado = await cadastrar();

      expect(resultado.accessToken).toEqual(expect.any(String));
    });

    it('o token devolvido autentica de verdade', async () => {
      const endereco = email();
      const { accessToken } = await cadastrar({ email: endereco });

      const claims = await jwt.verifyAsync(accessToken);

      // O guard lê `sub` e `role`; sem os dois o token passa e a autorização
      // decide com `undefined`.
      expect(claims.sub).toEqual(expect.any(String));
      expect(claims.role).toBe(UserRole.OWNER);

      const usuario = await users.getUserById(claims.sub);
      expect(usuario.email).toBe(endereco);
    });

    it('a conta criada entra pelo sign-in com a mesma senha', async () => {
      const endereco = email();
      await cadastrar({ email: endereco, password: 'senha-bem-forte' });

      const login = await auth.authenticate({
        email: endereco,
        password: 'senha-bem-forte',
      });

      expect(login.accessToken).toEqual(expect.any(String));
    });

    it('grava a senha com hash, nunca em texto puro', async () => {
      const endereco = email();
      await cadastrar({ email: endereco, password: 'senha-bem-forte' });

      const gravado = await prisma.user.findUnique({
        where: { email: endereco },
      });

      expect(gravado.password).not.toBe('senha-bem-forte');
      expect(gravado.password.startsWith('$2')).toBe(true);
    });

    it('recusa e-mail já cadastrado', async () => {
      const endereco = email();
      await cadastrar({ email: endereco });

      await expect(cadastrar({ email: endereco })).rejects.toThrow(
        ConflictException,
      );
    });

    /**
     * Rota pública: aceitar o papel informado pelo cliente deixaria qualquer um
     * se cadastrar com o papel que quisesse. O DTO não tem o campo e a criação
     * não o lê — este teste tranca as duas pontas.
     */
    it('ignora um papel informado no corpo', async () => {
      const endereco = email();
      const { accessToken } = await cadastrar({
        email: endereco,
        role: UserRole.STAFF,
      });

      const claims = await jwt.verifyAsync(accessToken);
      expect(claims.role).toBe(UserRole.OWNER);

      const gravado = await prisma.user.findUnique({
        where: { email: endereco },
      });
      expect(gravado.role).toBe(UserRole.OWNER);
    });
  });

  // ---------------------------------------------------------------------------

  describe('não vaza a senha', () => {
    /**
     * Regressão: `create` devolvia o registro inteiro, e o hash saía na
     * resposta do cadastro. Hash não serve para nada no cliente, e circular
     * com ele só amplia a superfície de vazamento.
     */
    it('a criação de usuário não devolve o hash', async () => {
      const criado = await users.create({
        name: 'Sem hash',
        email: email(),
        password: 'senha-bem-forte',
      });

      expect(criado).not.toHaveProperty('password');
      expect(Object.keys(criado).sort()).toEqual([
        'createdAt',
        'email',
        'id',
        'name',
        'role',
      ]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('sign-in', () => {
    it('recusa senha errada sem dizer qual campo falhou', async () => {
      const endereco = email();
      await cadastrar({ email: endereco, password: 'senha-bem-forte' });

      await expect(
        auth.authenticate({ email: endereco, password: 'senha-errada-aqui' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('recusa e-mail inexistente com a mesma mensagem', async () => {
      // Mensagens diferentes para "e-mail não existe" e "senha errada"
      // transformariam o login num verificador de quem tem conta.
      const inexistente = auth.authenticate({
        email: `nao-existe${EMAIL_DOMAIN}`,
        password: 'senha-bem-forte',
      });

      await expect(inexistente).rejects.toThrow('Invalid credentials.');
    });
  });
});
