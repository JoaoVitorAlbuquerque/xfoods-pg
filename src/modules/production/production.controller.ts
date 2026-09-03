import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { ProductionService } from './services/production.service';
import {
  ConfirmProductionOrderDto,
  CreateProductionOrderDto,
  ListProductionOrdersDto,
} from './dto/production.dto';

/**
 * Ordens de produção de subprodutos.
 *
 * O lote nasce rascunho e só encosta no estoque quando confirmado — mesma
 * mecânica da nota de compra, pelo mesmo motivo: registrar a intenção não pode
 * mexer no saldo.
 */
@Controller('production-orders')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Get()
  findAll(
    @ActiveUserId() userId: string,
    @Query() filters: ListProductionOrdersDto,
  ) {
    return this.productionService.findAllByUserId(userId, filters);
  }

  /**
   * Rendimento previsto contra o real. Declarado antes de `:id` para a rota não
   * ser capturada pelo curinga.
   */
  @Get('yield-report')
  getYieldReport(
    @ActiveUserId() userId: string,
    @Query() filters: ListProductionOrdersDto,
  ) {
    return this.productionService.getYieldReport(userId, filters);
  }

  @Get(':productionOrderId')
  findOne(
    @ActiveUserId() userId: string,
    @Param('productionOrderId', ParseUUIDPipe) productionOrderId: string,
  ) {
    return this.productionService.findOne(userId, productionOrderId);
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createProductionOrderDto: CreateProductionOrderDto,
  ) {
    return this.productionService.create(userId, createProductionOrderDto);
  }

  /** Consome os ingredientes e produz o subproduto, numa transação só. */
  @Patch(':productionOrderId/confirm')
  confirm(
    @ActiveUserId() userId: string,
    @Param('productionOrderId', ParseUUIDPipe) productionOrderId: string,
    @Body() confirmProductionOrderDto: ConfirmProductionOrderDto,
  ) {
    return this.productionService.confirm(
      userId,
      productionOrderId,
      confirmProductionOrderDto,
    );
  }

  @Patch(':productionOrderId/cancel')
  cancel(
    @ActiveUserId() userId: string,
    @Param('productionOrderId', ParseUUIDPipe) productionOrderId: string,
  ) {
    return this.productionService.cancel(userId, productionOrderId);
  }
}
