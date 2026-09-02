import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { PricingService } from './services/pricing.service';
import { PricingSettingsService } from './services/pricing-settings.service';
import {
  PricingQueryDto,
  SimulatePricingDto,
  UpdatePricingSettingsDto,
} from './dto/pricing.dto';

/**
 * Formação de preço. Só leitura e configuração: nenhuma rota aqui escreve em
 * `products.price` — o preço recomendado é sugestão, e aplicá-la é decisão de
 * quem vende.
 */
@Controller('pricing')
// Pipe próprio porque o global do `main.ts` não converte tipos, e a lista de
// margens do simulador chega como texto separado por vírgula.
@UsePipes(new ValidationPipe({ transform: true }))
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly settingsService: PricingSettingsService,
  ) {}

  @Get('settings')
  getSettings(@ActiveUserId() userId: string) {
    return this.settingsService.get(userId);
  }

  @Put('settings')
  updateSettings(
    @ActiveUserId() userId: string,
    @Body() dto: UpdatePricingSettingsDto,
  ) {
    return this.settingsService.update(userId, dto);
  }

  /**
   * Simulador de cenários. Declarado antes de `products/:productId` para a rota
   * não ser capturada pelo curinga.
   */
  @Get('simulate')
  simulate(
    @ActiveUserId() userId: string,
    @Query() dto: SimulatePricingDto,
  ) {
    return this.pricingService.simulate(userId, dto);
  }

  /** Preço atual x recomendado, para todo o cardápio com ficha ativa. */
  @Get('products')
  getProducts(
    @ActiveUserId() userId: string,
    @Query() filters: PricingQueryDto,
  ) {
    return this.pricingService.getProductPricing(userId, filters);
  }

  /** Um prato: composição do custo, rentabilidade e arredondamento. */
  @Get('products/:productId')
  getProduct(
    @ActiveUserId() userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() filters: PricingQueryDto,
  ) {
    return this.pricingService.getProductPricingDetail(
      userId,
      productId,
      filters,
    );
  }
}
