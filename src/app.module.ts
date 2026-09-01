import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DatabaseModule } from './shared/database/database.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { CategoriesModule } from './modules/categories/categories.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MeasurementUnitsModule } from './modules/measurement-units/measurement-units.module';
import { SuppliesModule } from './modules/supplies/supplies.module';
import { StockModule } from './modules/stock/stock.module';
import { PurchasesModule } from './modules/purchases/purchases.module';

@Module({
  imports: [
    UsersModule,
    DatabaseModule,
    AuthModule,
    CategoriesModule,
    IngredientsModule,
    ProductsModule,
    OrdersModule,
    LeadsModule,
    MeasurementUnitsModule,
    SuppliesModule,
    StockModule,
    PurchasesModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // Registrado depois do AuthGuard de propósito: depende do `userRole`
    // que o AuthGuard grava no request.
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
