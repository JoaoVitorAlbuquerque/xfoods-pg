import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MeasurementUnit,
  Prisma,
  StockMovementType,
  UnitKind,
} from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { UnitConversionService } from 'src/modules/measurement-units/services/unit-conversion.service';
import { StockSettingsService } from './stock-settings.service';

export class InsufficientStockException extends ConflictException {
  constructor(
    supplyName: string,
    available: Prisma.Decimal,
    requested: Prisma.Decimal,
    unitCode: string,
  ) {
    super(
      `Insufficient stock for ${supplyName}: ${available.toString()} ${unitCode} ` +
        `available, ${requested.toString()} ${unitCode} requested. Enable ` +
        'allowNegativeStock in the stock settings to permit negative balances.',
    );
  }
}

export type MovementDirection = 'IN' | 'OUT';

export type RegisterMovementInput = {
  supplyId: string;
  type: StockMovementType;
  direction: MovementDirection;
  /** Magnitude, sempre positiva. O sentido vem de `direction`. */
  quantity: Prisma.Decimal | string | number;
  /** Sigla da unidade informada. Ausente = unidade base do insumo. */
  unitCode?: string;
  /** Custo por unidade INFORMADA (não por unidade base). Só usado em entradas. */
  unitCost?: Prisma.Decimal | string | number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  occurredAt?: Date;
  /**
   * Ignora a trava de saldo negativo mesmo com `allowNegativeStock` desligado.
   * Existe para a baixa automática da venda: travar o caixa porque o sistema
   * acha que acabou a farinha é pior do que registrar o saldo negativo.
   */
  forceNegative?: boolean;
};

/**
 * Motor do livro-razão. Toda alteração de saldo passa por aqui, e nenhum saldo
 * é escrito sem a movimentação correspondente na mesma transação.
 *
 * O insumo é travado com SELECT ... FOR UPDATE antes de ler o saldo: sem isso,
 * duas saídas simultâneas leriam o mesmo saldo, ambas passariam na checagem e
 * o estoque ficaria negativo com `allowNegativeStock` desligado.
 */
@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly unitConversionService: UnitConversionService,
    private readonly stockSettingsService: StockSettingsService,
  ) {}

  /**
   * `tx` permite compor com uma transação em andamento — é assim que a baixa
   * automática da venda vai gravar consumo e pagamento atomicamente.
   */
  async register(
    userId: string,
    input: RegisterMovementInput,
    tx?: Prisma.TransactionClient,
  ) {
    if (tx) {
      return this.registerWithin(tx, userId, input);
    }

    return this.prismaService.$transaction((transaction) =>
      this.registerWithin(transaction, userId, input),
    );
  }

  async registerMany(
    userId: string,
    inputs: RegisterMovementInput[],
    tx?: Prisma.TransactionClient,
  ) {
    if (tx) {
      const results = [];
      for (const input of inputs) {
        results.push(await this.registerWithin(tx, userId, input));
      }
      return results;
    }

    return this.prismaService.$transaction(async (transaction) => {
      const results = [];
      for (const input of inputs) {
        results.push(await this.registerWithin(transaction, userId, input));
      }
      return results;
    });
  }

  /**
   * Ajuste por saldo absoluto: "o correto é 23,5 kg". A diferença contra o
   * saldo do sistema vira o movimento.
   *
   * O cálculo da diferença acontece dentro da mesma transação que grava o
   * movimento, e depois do FOR UPDATE — calcular fora abriria a janela para o
   * saldo mudar entre a leitura e a escrita, e o ajuste corrigiria para um
   * número que já não era o certo.
   */
  async adjustTo(
    userId: string,
    input: {
      supplyId: string;
      targetQuantity: Prisma.Decimal | string | number;
      unitCode?: string;
      reason?: string;
      referenceType?: string;
      referenceId?: string;
      occurredAt?: Date;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const run = async (transaction: Prisma.TransactionClient) => {
      const target = this.parsePositiveQuantity(input.targetQuantity);

      await transaction.$executeRaw`
        SELECT 1 FROM supplies
        WHERE id = ${input.supplyId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `;

      const supply = await transaction.supply.findFirst({
        where: { id: input.supplyId, userId },
        include: { baseUnit: true },
      });

      if (!supply) {
        throw new NotFoundException('Supply not found.');
      }

      const unit = input.unitCode
        ? await this.resolveUnit(transaction, userId, input.unitCode)
        : supply.baseUnit;

      if (unit.kind !== supply.baseUnit.kind) {
        throw new BadRequestException(
          `Cannot count ${supply.name} in ${unit.code} (${unit.kind}): its ` +
            `base unit is ${supply.baseUnit.code} (${supply.baseUnit.kind}).`,
        );
      }

      const targetBase = this.unitConversionService.convert(
        target,
        unit,
        supply.baseUnit,
      );
      const currentStock = new Prisma.Decimal(supply.currentStock);
      const difference = targetBase.sub(currentStock);

      if (difference.isZero()) {
        return {
          movement: null,
          systemQuantityBase: currentStock,
          countedQuantityBase: targetBase,
          differenceBase: difference,
        };
      }

      const movement = await this.registerWithin(transaction, userId, {
        supplyId: supply.id,
        type: StockMovementType.ADJUSTMENT,
        direction: difference.gt(0) ? 'IN' : 'OUT',
        quantity: difference.abs(),
        unitCode: supply.baseUnit.code,
        reason: input.reason,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        occurredAt: input.occurredAt,
        // O alvo já foi validado como não negativo, então o saldo final nunca
        // fica abaixo de zero — a trava não tem o que barrar aqui.
        forceNegative: true,
      });

      return {
        movement,
        systemQuantityBase: currentStock,
        countedQuantityBase: targetBase,
        differenceBase: difference,
      };
    };

    if (tx) {
      return run(tx);
    }

    return this.prismaService.$transaction(run);
  }

  private async registerWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    input: RegisterMovementInput,
  ) {
    const quantity = this.parsePositiveQuantity(input.quantity);

    // Trava a linha do insumo antes de qualquer leitura de saldo. Outra
    // transação que queira mexer no mesmo insumo espera aqui.
    await tx.$executeRaw`
      SELECT 1 FROM supplies
      WHERE id = ${input.supplyId}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE
    `;

    const supply = await tx.supply.findFirst({
      where: { id: input.supplyId, userId },
      include: { baseUnit: true },
    });

    if (!supply) {
      throw new NotFoundException('Supply not found.');
    }

    const unit = input.unitCode
      ? await this.resolveUnit(tx, userId, input.unitCode)
      : supply.baseUnit;

    if (unit.kind !== supply.baseUnit.kind) {
      throw new BadRequestException(
        `Cannot register ${unit.code} (${unit.kind}) for ${supply.name}, ` +
          `whose base unit is ${supply.baseUnit.code} (${supply.baseUnit.kind}).`,
      );
    }

    const quantityBaseMagnitude = this.unitConversionService.convert(
      quantity,
      unit,
      supply.baseUnit,
    );

    const sign = input.direction === 'OUT' ? -1 : 1;
    const signedQuantity = quantity.mul(sign);
    const signedQuantityBase = quantityBaseMagnitude.mul(sign);

    const currentStock = new Prisma.Decimal(supply.currentStock);
    const balanceAfter = currentStock.add(signedQuantityBase);

    if (balanceAfter.lt(0) && !input.forceNegative) {
      const allowNegative = await this.stockSettingsService.allowsNegativeStock(
        userId,
        tx,
      );

      if (!allowNegative) {
        throw new InsufficientStockException(
          supply.name,
          currentStock,
          quantityBaseMagnitude,
          supply.baseUnit.code,
        );
      }
    }

    const averageCost = new Prisma.Decimal(supply.averageCost);

    // Custo por unidade base. Na entrada vem do que foi informado; na saída,
    // do custo médio atual — é ele que valoriza o que sai.
    let unitCostBase = averageCost;
    let informedCostBase: Prisma.Decimal | null = null;

    if (input.unitCost !== undefined && input.unitCost !== null) {
      const unitCostInformed = this.parsePositiveQuantity(input.unitCost);
      const totalInformed = unitCostInformed.mul(quantity);

      informedCostBase = quantityBaseMagnitude.isZero()
        ? new Prisma.Decimal(0)
        : totalInformed.div(quantityBaseMagnitude);

      unitCostBase = informedCostBase;
    }

    const totalCost = unitCostBase.mul(quantityBaseMagnitude).mul(sign);

    const movement = await tx.stockMovement.create({
      data: {
        userId,
        supplyId: supply.id,
        unitId: unit.id,
        type: input.type,
        quantity: signedQuantity,
        quantityBase: signedQuantityBase,
        unitCost: unitCostBase,
        totalCost,
        balanceAfter,
        reason: input.reason,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        occurredAt: input.occurredAt ?? new Date(),
      },
      include: { supply: { select: { name: true } }, unit: true },
    });

    const supplyUpdate: Prisma.SupplyUpdateInput = {
      currentStock: balanceAfter,
    };

    // Custo médio ponderado: só entradas com custo informado o movem. Uma
    // saída consome ao custo médio vigente e não o altera; um ajuste positivo
    // encontrou estoque que já existia, e portanto ao mesmo custo.
    if (
      input.direction === 'IN' &&
      informedCostBase !== null &&
      balanceAfter.gt(0)
    ) {
      const previousValue = currentStock.gt(0)
        ? currentStock.mul(averageCost)
        : new Prisma.Decimal(0);
      const incomingValue = quantityBaseMagnitude.mul(informedCostBase);
      const quantityForAverage = currentStock.gt(0)
        ? currentStock.add(quantityBaseMagnitude)
        : quantityBaseMagnitude;

      supplyUpdate.averageCost = previousValue
        .add(incomingValue)
        .div(quantityForAverage);
      supplyUpdate.lastCost = informedCostBase;
    }

    await tx.supply.update({
      where: { id: supply.id },
      data: supplyUpdate,
    });

    return movement;
  }

  private async resolveUnit(
    tx: Prisma.TransactionClient,
    userId: string,
    code: string,
  ): Promise<MeasurementUnit> {
    const normalized = code.trim().toUpperCase();

    const unit = await tx.measurementUnit.findFirst({
      where: {
        code: normalized,
        active: true,
        OR: [{ userId: null }, { userId }],
      },
    });

    if (!unit) {
      throw new NotFoundException(`Measurement unit ${normalized} not found.`);
    }

    return unit;
  }

  private parsePositiveQuantity(
    value: Prisma.Decimal | string | number,
  ): Prisma.Decimal {
    let parsed: Prisma.Decimal;

    try {
      parsed = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(
        `Quantity must be a finite number, received ${String(value)}.`,
      );
    }

    if (!parsed.isFinite()) {
      throw new BadRequestException(
        `Quantity must be a finite number, received ${String(value)}.`,
      );
    }

    if (parsed.isNegative()) {
      throw new BadRequestException(
        'Quantity must not be negative. Use the direction of the operation ' +
          'to express an exit.',
      );
    }

    return parsed;
  }

  /** Grandezas aceitas como unidade base de um insumo. */
  static readonly STOCKABLE_KINDS: UnitKind[] = [
    UnitKind.WEIGHT,
    UnitKind.VOLUME,
    UnitKind.COUNT,
  ];
}
