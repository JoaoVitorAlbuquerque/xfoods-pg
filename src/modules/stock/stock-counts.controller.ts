import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { StockCountsService } from './services/stock-counts.service';
import { CreateStockCountDto } from './dto/create-stock-count.dto';

@Controller('stock-counts')
export class StockCountsController {
  constructor(private readonly stockCountsService: StockCountsService) {}

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.stockCountsService.findAllByUserId(userId);
  }

  @Get(':stockCountId')
  findOne(
    @ActiveUserId() userId: string,
    @Param('stockCountId', ParseUUIDPipe) stockCountId: string,
  ) {
    return this.stockCountsService.findOne(userId, stockCountId);
  }

  /** Registra a contagem. Nada afeta o estoque até ser aplicada. */
  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createStockCountDto: CreateStockCountDto,
  ) {
    return this.stockCountsService.create(userId, createStockCountDto);
  }

  /** Gera os ajustes de cada item com diferença, tudo em uma transação. */
  @Patch(':stockCountId/apply')
  apply(
    @ActiveUserId() userId: string,
    @Param('stockCountId', ParseUUIDPipe) stockCountId: string,
  ) {
    return this.stockCountsService.apply(userId, stockCountId);
  }

  @Patch(':stockCountId/cancel')
  cancel(
    @ActiveUserId() userId: string,
    @Param('stockCountId', ParseUUIDPipe) stockCountId: string,
  ) {
    return this.stockCountsService.cancel(userId, stockCountId);
  }
}
