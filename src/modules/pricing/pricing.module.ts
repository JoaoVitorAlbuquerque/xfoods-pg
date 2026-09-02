import { Module } from '@nestjs/common';

import { ExpensesModule } from '../expenses/expenses.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './services/pricing.service';
import { PricingSettingsService } from './services/pricing-settings.service';
import { PricingCalculatorService } from './services/pricing-calculator.service';

/**
 * Formação de preço. Depende de ExpensesModule pelo custo completo, que já é
 * ficha técnica mais rateio — as duas metades do custo saem do mesmo lugar em
 * vez de serem recalculadas aqui.
 */
@Module({
  imports: [ExpensesModule],
  controllers: [PricingController],
  providers: [PricingService, PricingSettingsService, PricingCalculatorService],
  exports: [PricingService, PricingCalculatorService, PricingSettingsService],
})
export class PricingModule {}
