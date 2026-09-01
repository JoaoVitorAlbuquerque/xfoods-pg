import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { SuppliersService } from './services/suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll(
    @ActiveUserId() userId: string,
    @Query('search') search?: string,
  ) {
    return this.suppliersService.findAllByUserId(userId, search);
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createSupplierDto: CreateSupplierDto,
  ) {
    return this.suppliersService.create(userId, createSupplierDto);
  }

  @Put(':supplierId')
  update(
    @ActiveUserId() userId: string,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(userId, supplierId, updateSupplierDto);
  }

  @Delete(':supplierId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    return this.suppliersService.remove(userId, supplierId);
  }
}
