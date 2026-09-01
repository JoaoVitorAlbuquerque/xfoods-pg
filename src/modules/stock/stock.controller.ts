import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { StockService } from './services/stock.service';
import { StockSettingsService } from './services/stock-settings.service';
import { ListMovementsDto } from './dto/list-movements.dto';
import { UpdateStockSettingsDto } from './dto/update-stock-settings.dto';
import {
  CreateStockAdjustmentDto,
  CreateStockEntryDto,
  CreateStockExitDto,
  CreateStockLossDto,
} from './dto/stock-operation.dto';

@Controller('stock')
export class StockController {
  constructor(
    private readonly stockService: StockService,
    private readonly stockSettingsService: StockSettingsService,
  ) {}

  /** Posição atual de todos os insumos ativos, do mais crítico ao normal. */
  @Get()
  getOverview(@ActiveUserId() userId: string) {
    return this.stockService.getOverview(userId);
  }

  /** Só o que precisa de atenção: negativo, zerado, abaixo do mínimo, acima do máximo. */
  @Get('alerts')
  getAlerts(@ActiveUserId() userId: string) {
    return this.stockService.getOverview(userId, true);
  }

  @Get('movements')
  getMovements(
    @ActiveUserId() userId: string,
    @Query() filters: ListMovementsDto,
  ) {
    return this.stockService.getMovements(userId, filters);
  }

  @Get('settings')
  getSettings(@ActiveUserId() userId: string) {
    return this.stockSettingsService.get(userId);
  }

  @Put('settings')
  updateSettings(
    @ActiveUserId() userId: string,
    @Body() updateStockSettingsDto: UpdateStockSettingsDto,
  ) {
    return this.stockSettingsService.update(userId, updateStockSettingsDto);
  }

  @Post('entries')
  registerEntry(
    @ActiveUserId() userId: string,
    @Body() createStockEntryDto: CreateStockEntryDto,
  ) {
    return this.stockService.registerEntry(userId, createStockEntryDto);
  }

  @Post('exits')
  registerExit(
    @ActiveUserId() userId: string,
    @Body() createStockExitDto: CreateStockExitDto,
  ) {
    return this.stockService.registerExit(userId, createStockExitDto);
  }

  @Post('losses')
  registerLoss(
    @ActiveUserId() userId: string,
    @Body() createStockLossDto: CreateStockLossDto,
  ) {
    return this.stockService.registerLoss(userId, createStockLossDto);
  }

  /** Ajuste por saldo absoluto: informe quanto realmente existe. */
  @Post('adjustments')
  registerAdjustment(
    @ActiveUserId() userId: string,
    @Body() createStockAdjustmentDto: CreateStockAdjustmentDto,
  ) {
    return this.stockService.registerAdjustment(
      userId,
      createStockAdjustmentDto,
    );
  }
}
