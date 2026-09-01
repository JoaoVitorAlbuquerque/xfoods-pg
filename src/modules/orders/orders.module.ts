import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { OrdersController } from './orders.controller';
import { ValidateOrderOwnershipService } from './services/validate-order-ownership.service';
import { ValidateLeadOwnershipService } from '../leads/services/validate-lead-ownership.service';
import { WsAuthGuard } from '../auth/ws-auth.guard';
import { RecipesModule } from '../recipes/recipes.module';
import { StockModule } from '../stock/stock.module';
import { OrderStockService } from './services/order-stock.service';

@Module({
  imports: [RecipesModule, StockModule],
  controllers: [OrdersController],
  providers: [
    OrdersGateway,
    OrdersService,
    OrderStockService,
    WsAuthGuard,
    ValidateOrderOwnershipService,
    ValidateLeadOwnershipService,
  ],
  exports: [
    ValidateOrderOwnershipService,
    ValidateLeadOwnershipService,
    OrderStockService,
  ],
})
export class OrdersModule {}
