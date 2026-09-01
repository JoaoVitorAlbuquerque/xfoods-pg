import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UsersRepository } from './repositories/users.repositories';
import { CategoriesRepository } from './repositories/categories.repositories';
import { IngredientsRepository } from './repositories/ingredients.repositories';
import { ProductsRepository } from './repositories/products.repositories';
import { OrdersRepository } from './repositories/orders.repositories';
import { LeadsRepository } from './repositories/leads.repositories';
import { MeasurementUnitsRepository } from './repositories/measurement-units.repositories';
import { SupplyCategoriesRepository } from './repositories/supply-categories.repositories';
import { SuppliesRepository } from './repositories/supplies.repositories';
import { StockMovementsRepository } from './repositories/stock-movements.repositories';
import { StockCountsRepository } from './repositories/stock-counts.repositories';
import { SuppliersRepository } from './repositories/suppliers.repositories';
import { PurchasesRepository } from './repositories/purchases.repositories';
import { SupplyCostHistoryRepository } from './repositories/supply-cost-history.repositories';

@Global()
@Module({
  providers: [
    PrismaService,
    UsersRepository,
    CategoriesRepository,
    IngredientsRepository,
    ProductsRepository,
    OrdersRepository,
    LeadsRepository,
    MeasurementUnitsRepository,
    SupplyCategoriesRepository,
    SuppliesRepository,
    StockMovementsRepository,
    StockCountsRepository,
    SuppliersRepository,
    PurchasesRepository,
    SupplyCostHistoryRepository,
  ],
  exports: [
    // Exportado a partir do módulo de estoque: movimentação e saldo precisam
    // ser escritos na mesma transação, com o insumo travado (SELECT ... FOR
    // UPDATE), e isso exige o client transacional — que os repositórios, por
    // serem repasses finos de `Prisma.XxxArgs`, não têm como entregar.
    PrismaService,
    UsersRepository,
    CategoriesRepository,
    IngredientsRepository,
    ProductsRepository,
    OrdersRepository,
    LeadsRepository,
    MeasurementUnitsRepository,
    SupplyCategoriesRepository,
    SuppliesRepository,
    StockMovementsRepository,
    StockCountsRepository,
    SuppliersRepository,
    PurchasesRepository,
    SupplyCostHistoryRepository,
  ],
})
export class DatabaseModule {}
