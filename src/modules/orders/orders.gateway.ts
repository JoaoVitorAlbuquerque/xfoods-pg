import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  WsAuthGuard,
  resolveSocketUserId,
  roomForUser,
} from '../auth/ws-auth.guard';
import { WsActiveUserId } from 'src/shared/decorators/WsActiveUserId';
import { serializeDecimals } from 'src/shared/interceptors/decimal-serializer.interceptor';

@WebSocketGateway({ cors: true })
export class OrdersGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    const userId = await resolveSocketUserId(client, this.jwtService);

    if (userId) {
      client.data.userId = userId;
      client.join(roomForUser(userId));
      return;
    }

    // Conexão sem token continua aceita: o Dashboard atual conecta assim e
    // apenas escuta. Sem token não há sala, então ele não recebe evento de
    // tenant nenhum — que é justamente o vazamento que o `server.emit` aberto
    // causaria. Para receber pedidos ao vivo, o cliente precisa conectar com
    // `socketIo(url, { auth: { token: accessToken } })`.
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('createOrder')
  async create(
    @WsActiveUserId() userId: string,
    @MessageBody() createOrderDto: CreateOrderDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      // O `await` faltava: o try/catch não capturava falha assíncrona e o
      // `orderCreated` era emitido com uma Promise no lugar do pedido.
      const order = await this.ordersService.create(userId, createOrderDto);

      // `serializeDecimals` aqui porque o emit não passa pelo interceptor
      // global — sem isso, `unitPrice` e `totalAmount` chegariam ao cliente
      // como objetos internos do Decimal.
      const payload = serializeDecimals(order);

      this.server.to(roomForUser(userId)).emit('orderCreated', payload);

      return { status: 'success', data: payload };
    } catch (error) {
      client.emit('orderError', { status: 'error', message: error.message });

      return { status: 'error', message: error.message };
    }
  }
}
