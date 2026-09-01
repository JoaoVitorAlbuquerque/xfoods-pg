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
import { PurchasesService } from './services/purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { ListPurchasesDto } from './dto/list-purchases.dto';

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  /** `?supplyId=` devolve o histórico de compras de um insumo. */
  @Get()
  findAll(@ActiveUserId() userId: string, @Query() filters: ListPurchasesDto) {
    return this.purchasesService.findAllByUserId(userId, filters);
  }

  @Get(':purchaseId')
  findOne(
    @ActiveUserId() userId: string,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
  ) {
    return this.purchasesService.findOne(userId, purchaseId);
  }

  /** Cria como rascunho. Nada de estoque acontece até a confirmação. */
  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createPurchaseDto: CreatePurchaseDto,
  ) {
    return this.purchasesService.create(userId, createPurchaseDto);
  }

  /** Entrada no estoque, custo atual e histórico — tudo em uma transação. */
  @Patch(':purchaseId/confirm')
  confirm(
    @ActiveUserId() userId: string,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
  ) {
    return this.purchasesService.confirm(userId, purchaseId);
  }

  @Patch(':purchaseId/cancel')
  cancel(
    @ActiveUserId() userId: string,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
  ) {
    return this.purchasesService.cancel(userId, purchaseId);
  }
}
