import {
  Controller,
  Get,
  Post,
  Body,
  // Patch,
  Param,
  Delete,
  // Put,
  ParseUUIDPipe,
  HttpCode,
  Patch,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { OrdersService } from './orders.service';
// import { UpdateOrderDto } from './dto/update-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.create(userId, createOrderDto);
  }

  @Get('dashboard')
  findAllDashboard(@ActiveUserId() userId: string) {
    return this.ordersService.findAllByUserIdDashboard(userId);
  }

  @Get('history')
  findAllHistory(
    @ActiveUserId() userId: string,
    @Query('month', ParseIntPipe) month: number,
    @Query('year', ParseIntPipe) year: number,
  ) {
    return this.ordersService.findAllByUserIdHistory(userId, { month, year });
  }

  @Get('financial')
  findAllFinancial(
    @ActiveUserId() userId: string,
    @Query('table', ParseIntPipe) table: number,
  ) {
    return this.ordersService.findAllByUserIdFinancial(userId, table);
  }

  // @Get(':id')
  // findOne(, @Param('id') id: string) {
  //   return this.ordersService.findOne(, id);
  // }

  // @Put(':orderId')
  // async update(
  //   @ActiveUserId() userId: string,
  //   @Param('orderId', ParseUUIDPipe) orderId: string,
  //   @Body() updateOrderDto: UpdateOrderDto,
  // ) {
  //   return this.ordersService.update(userId, orderId, updateOrderDto);
  // }

  @Patch('associate-lead')
  associateLeadWithOrders(
    @ActiveUserId() userId: string,
    @Body('leadId', ParseUUIDPipe) leadId: string,
    @Body('orderIds') orderIds: string[],
  ) {
    return this.ordersService.associateLeadWithOrders(userId, leadId, orderIds);
  }

  @Patch(':orderId/order-status')
  async updateOrderStatus(
    @ActiveUserId() userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    return this.ordersService.updateOrderStatus(
      userId,
      orderId,
      updateOrderDto,
    );
  }

  @Patch('restarted')
  async updateOrderRestarted(@ActiveUserId() userId: string) {
    return this.ordersService.updateOrderRestarted(userId);
  }

  @Patch(':orderId/read')
  async updateOrderRead(
    @ActiveUserId() userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.ordersService.updateOrderRead(userId, orderId);
  }

  @Patch('paid')
  async updateOrderPaid(
    @ActiveUserId() userId: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    return this.ordersService.updateOrderPaid(userId, updateOrderDto);
  }

  @Delete(':orderId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.ordersService.remove(userId, orderId);
  }
}
