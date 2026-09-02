import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { ExpensesService } from './services/expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpensePeriodDto, ListExpensesDto } from './dto/list-expenses.dto';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  findAll(@ActiveUserId() userId: string, @Query() filters: ListExpensesDto) {
    return this.expensesService.findAllByUserId(userId, filters);
  }

  /**
   * Extrato de competências do período: cada repetição da regra vira uma linha.
   * Declarado antes de `:expenseId` para a rota não ser capturada pelo curinga.
   */
  @Get('occurrences')
  getOccurrences(
    @ActiveUserId() userId: string,
    @Query() filters: ExpensePeriodDto,
  ) {
    return this.expensesService.getOccurrences(userId, filters);
  }

  /** Total do período por categoria, tipo e periodicidade. */
  @Get('summary')
  getSummary(
    @ActiveUserId() userId: string,
    @Query() filters: ExpensePeriodDto,
  ) {
    return this.expensesService.getSummary(userId, filters);
  }

  @Get(':expenseId')
  findOne(
    @ActiveUserId() userId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return this.expensesService.findOne(userId, expenseId);
  }

  @Post()
  create(
    @ActiveUserId() userId: string,
    @Body() createExpenseDto: CreateExpenseDto,
  ) {
    return this.expensesService.create(userId, createExpenseDto);
  }

  @Put(':expenseId')
  update(
    @ActiveUserId() userId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() updateExpenseDto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(userId, expenseId, updateExpenseDto);
  }

  /** Volta a valer a partir de agora; limpa a data de desativação. */
  @Patch(':expenseId/activate')
  activate(
    @ActiveUserId() userId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return this.expensesService.setActive(userId, expenseId, true);
  }

  /** Para de repetir daqui pra frente. As competências passadas continuam. */
  @Patch(':expenseId/deactivate')
  deactivate(
    @ActiveUserId() userId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return this.expensesService.setActive(userId, expenseId, false);
  }

  @Delete(':expenseId')
  @HttpCode(204)
  remove(
    @ActiveUserId() userId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return this.expensesService.remove(userId, expenseId);
  }
}
