import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { MeasurementUnitsService } from './services/measurement-units.service';
import { CreateMeasurementUnitDto } from './dto/create-measurement-unit.dto';
import { UpdateMeasurementUnitDto } from './dto/update-measurement-unit.dto';
import { ConvertQuantityDto } from './dto/convert-quantity.dto';

@Controller('measurement-units')
export class MeasurementUnitsController {
  constructor(
    private readonly measurementUnitsService: MeasurementUnitsService,
  ) {}

  @Get()
  findAll(
    @ActiveUserId() userId: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.measurementUnitsService.findAllByUserId(
      userId,
      includeInactive ?? false,
    );
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createMeasurementUnitDto: CreateMeasurementUnitDto,
  ) {
    return this.measurementUnitsService.create(
      userId,
      createMeasurementUnitDto,
    );
  }

  /**
   * Conversão autoritativa no servidor. A listagem já devolve `factorToBase`,
   * então a interface pode converter localmente para pré-visualizar — mas todo
   * valor que for persistido deve passar por aqui.
   */
  @Post('convert')
  @HttpCode(200)
  convert(
    @ActiveUserId() userId: string,
    @Body() convertQuantityDto: ConvertQuantityDto,
  ) {
    return this.measurementUnitsService.convert(userId, convertQuantityDto);
  }

  @Put(':unitId')
  update(
    @ActiveUserId() userId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() updateMeasurementUnitDto: UpdateMeasurementUnitDto,
  ) {
    return this.measurementUnitsService.update(
      userId,
      unitId,
      updateMeasurementUnitDto,
    );
  }

  @Delete(':unitId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ) {
    return this.measurementUnitsService.remove(userId, unitId);
  }
}
