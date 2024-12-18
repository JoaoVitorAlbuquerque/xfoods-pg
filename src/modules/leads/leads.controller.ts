import {
  Controller,
  Get,
  Post,
  Body,
  // Patch,
  Param,
  Delete,
  HttpCode,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  create(@ActiveUserId() userId: string, @Body() createLeadDto: CreateLeadDto) {
    return this.leadsService.create(userId, createLeadDto);
  }

  @Get()
  findAll(@ActiveUserId() userId: string) {
    return this.leadsService.findAllByUserId(userId);
  }

  @Get(':leadId/orders')
  findAllOrdersByLeads(
    @ActiveUserId() userId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.leadsService.findAllOrdersByLeads(userId, leadId);
  }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.leadsService.findOne(+id);
  // }

  @Put(':leadId')
  update(
    @ActiveUserId() userId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() updateLeadDto: UpdateLeadDto,
  ) {
    return this.leadsService.update(userId, leadId, updateLeadDto);
  }

  @Delete(':leadId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ) {
    return this.leadsService.remove(userId, leadId);
  }
}
