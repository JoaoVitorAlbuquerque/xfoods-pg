import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { env } from 'src/shared/config/env';

/**
 * O AuthGuard global é registrado como APP_GUARD e só cobre o contexto HTTP —
 * gateways WebSocket ficavam sem autenticação nenhuma. Além disso, o decorator
 * `@ActiveUserId()` lê `context.switchToHttp().getRequest()`, que em contexto
 * WebSocket não devolve o request onde o userId teria sido gravado.
 *
 * Este guard resolve o token do handshake do socket e grava o userId em
 * `client.data`, de onde o `@WsActiveUserId()` o lê.
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const userId = await resolveSocketUserId(client, this.jwtService);

    if (!userId) {
      throw new WsException('Unauthorized');
    }

    client.data.userId = userId;

    return true;
  }
}

/** Sala do socket.io por tenant, para o evento não vazar entre restaurantes. */
export function roomForUser(userId: string) {
  return `user:${userId}`;
}

export async function resolveSocketUserId(
  client: Socket,
  jwtService: JwtService,
): Promise<string | null> {
  const token = extractTokenFromHandshake(client);

  if (!token) {
    return null;
  }

  try {
    const payload = await jwtService.verifyAsync(token, {
      secret: env.jwtSecret,
    });

    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function extractTokenFromHandshake(client: Socket): string | undefined {
  const fromAuth = client.handshake?.auth?.token;

  if (typeof fromAuth === 'string' && fromAuth.length > 0) {
    return fromAuth.replace(/^Bearer\s+/i, '');
  }

  const [type, token] =
    client.handshake?.headers?.authorization?.split(' ') ?? [];

  return type === 'Bearer' ? token : undefined;
}
