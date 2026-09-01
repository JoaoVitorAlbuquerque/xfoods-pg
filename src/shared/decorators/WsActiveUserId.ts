import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

/**
 * Equivalente do `@ActiveUserId()` para o contexto WebSocket. O userId vem de
 * `client.data`, gravado pelo `WsAuthGuard` ou pelo `handleConnection` do gateway.
 */
export const WsActiveUserId = createParamDecorator<undefined>(
  (_data, context: ExecutionContext) => {
    const client = context.switchToWs().getClient<Socket>();
    const userId = client?.data?.userId;

    if (!userId) {
      throw new WsException('Unauthorized');
    }

    return userId;
  },
);
