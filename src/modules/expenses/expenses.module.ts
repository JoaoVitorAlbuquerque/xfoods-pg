import { Module } from '@nestjs/common';

import { RecipesModule } from '../recipes/recipes.module';
import { ExpensesController } from './expenses.controller';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { CostAllocationController } from './cost-allocation.controller';
import { ExpensesService } from './services/expenses.service';
import { ExpenseCategoriesService } from './services/expense-categories.service';
import { ExpenseRecurrenceService } from './services/expense-recurrence.service';
import { CostAllocationService } from './services/cost-allocation.service';

/**
 * Despesas operacionais e o rateio delas sobre o que foi vendido.
 *
 * Depende de RecipesModule para o custo direto: custo completo é ficha técnica
 * mais rateio, e as duas metades precisam sair do mesmo lugar.
 */
@Module({
  imports: [RecipesModule],
  controllers: [
    ExpensesController,
    ExpenseCategoriesController,
    CostAllocationController,
  ],
  providers: [
    ExpensesService,
    ExpenseCategoriesService,
    ExpenseRecurrenceService,
    CostAllocationService,
  ],
  // Exportados para a formação de preço, que vai precisar do custo completo
  // sem reimplementar a competência.
  exports: [ExpensesService, ExpenseRecurrenceService, CostAllocationService],
})
export class ExpensesModule {}
