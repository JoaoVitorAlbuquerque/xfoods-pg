import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { SuppliesService } from './services/supplies.service';
import { CreateSupplyDto } from './dto/create-supply.dto';
import { UpdateSupplyDto } from './dto/update-supply.dto';
import { ListSuppliesDto } from './dto/list-supplies.dto';
import { SetSupplyActiveDto } from './dto/set-supply-active.dto';

@Controller('supplies')
export class SuppliesController {
  constructor(private readonly suppliesService: SuppliesService) {}

  @Get()
  findAll(@ActiveUserId() userId: string, @Query() filters: ListSuppliesDto) {
    return this.suppliesService.findAllByUserId(userId, filters);
  }

  @Get(':supplyId')
  findOne(
    @ActiveUserId() userId: string,
    @Param('supplyId', ParseUUIDPipe) supplyId: string,
  ) {
    return this.suppliesService.findOne(userId, supplyId);
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createSupplyDto: CreateSupplyDto,
  ) {
    return this.suppliesService.create(userId, createSupplyDto);
  }

  @Put(':supplyId')
  update(
    @ActiveUserId() userId: string,
    @Param('supplyId', ParseUUIDPipe) supplyId: string,
    @Body() updateSupplyDto: UpdateSupplyDto,
  ) {
    return this.suppliesService.update(userId, supplyId, updateSupplyDto);
  }

  /**
   * Insumo não é apagado: ele é inativado. O histórico de movimentações
   * continua fazendo sentido, e a ficha técnica que o usa continua explicável.
   */
  @Patch(':supplyId/active')
  setActive(
    @ActiveUserId() userId: string,
    @Param('supplyId', ParseUUIDPipe) supplyId: string,
    @Body() setSupplyActiveDto: SetSupplyActiveDto,
  ) {
    return this.suppliesService.setActive(
      userId,
      supplyId,
      setSupplyActiveDto.active,
    );
  }
}
