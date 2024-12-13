import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { OrdersController } from './orders.controller';
import { ValidateOrderOwnershipService } from './services/validate-order-ownership.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersGateway, OrdersService, ValidateOrderOwnershipService],
  exports: [ValidateOrderOwnershipService],
})
export class OrdersModule {}
