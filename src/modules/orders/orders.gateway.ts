import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
// import { UpdateOrderDto } from './dto/update-order.dto';
import { Server, Socket } from 'socket.io';
import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';

@WebSocketGateway({ cors: true })
export class OrdersGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly ordersService: OrdersService) {}

  @SubscribeMessage('createOrder')
  create(
    @ActiveUserId() userId: string,
    @MessageBody() createOrderDto: CreateOrderDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const order = this.ordersService.create(userId, createOrderDto);

      this.server.emit('orderCreated', order);

      return { status: 'success', data: order };
    } catch (error) {
      client.emit('orderError', { status: 'error', message: error.message });
    }
  }

  // @SubscribeMessage('findAllOrders')
  // findAll() {
  //   return this.ordersService.findAll();
  // }

  // @SubscribeMessage('findOneOrder')
  // findOne(@MessageBody() id: number) {
  //   return this.ordersService.findOne(id);
  // }

  // @SubscribeMessage('updateOrder')
  // update(
  //   @ActiveUserId() userId: string,
  //   @MessageBody() updateOrderDto: UpdateOrderDto,
  // ) {
  //   return this.ordersService.update(userId, updateOrderDto.id, updateOrderDto);
  // }

  // @SubscribeMessage('removeOrder')
  // remove(@ActiveUserId() userId: string, @MessageBody() orderId: string) {
  //   return this.ordersService.remove(userId, orderId);
  // }
}
