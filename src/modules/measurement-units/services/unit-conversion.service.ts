import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UnitKind } from '@prisma/client';

/**
 * Forma mínima que a conversão precisa conhecer. Propositalmente não é o
 * modelo do Prisma: manter o serviço desacoplado do banco é o que permite
 * testá-lo sem subir o Nest nem o Postgres.
 */
export type ConvertibleUnit = {
  code: string;
  kind: UnitKind;
  factorToBase: Prisma.Decimal | string | number | null;
};

export class IncompatibleUnitsException extends BadRequestException {
  constructor(from: ConvertibleUnit, to: ConvertibleUnit) {
    super(
      `Cannot convert ${from.code} (${from.kind}) to ${to.code} (${to.kind}): ` +
        'units of different kinds are never interchangeable.',
    );
  }
}

export class PackagingUnitConversionException extends BadRequestException {
  constructor(unit: ConvertibleUnit) {
    super(
      `Unit ${unit.code} has no universal conversion factor because it is a ` +
        'packaging unit. Its factor depends on the supply it packages and is ' +
        'defined per supply, not globally.',
    );
  }
}

export class NegativeQuantityException extends BadRequestException {
  constructor(quantity: unknown) {
    super(`Quantity must not be negative, received ${String(quantity)}.`);
  }
}

export class InvalidQuantityException extends BadRequestException {
  constructor(quantity: unknown) {
    super(`Quantity must be a finite number, received ${String(quantity)}.`);
  }
}

export class InvalidConversionFactorException extends BadRequestException {
  constructor(unit: ConvertibleUnit) {
    super(
      `Unit ${unit.code} has an invalid conversion factor: it must be a ` +
        'finite number greater than zero.',
    );
  }
}

/**
 * Converte quantidades entre unidades da mesma grandeza.
 *
 * Toda conversão passa pela base canônica da grandeza (G, ML, UN), então
 * acrescentar uma unidade nova nunca exige mexer nas existentes.
 *
 * Contagem não se converte em massa nem em volume: 1 KG não é 1 UN. A recusa
 * vem do `kind`, comparado antes de qualquer cálculo.
 *
 * Tudo é `Prisma.Decimal`. O resultado sai com a precisão cheia da divisão —
 * arredondar é responsabilidade de quem persiste, que é quem conhece a escala
 * da coluna de destino.
 */
@Injectable()
export class UnitConversionService {
  convert(
    quantity: Prisma.Decimal | string | number,
    from: ConvertibleUnit,
    to: ConvertibleUnit,
  ): Prisma.Decimal {
    this.assertCompatible(from, to);

    const parsedQuantity = this.parseQuantity(quantity);
    const fromFactor = this.resolveFactor(from);
    const toFactor = this.resolveFactor(to);

    // Mesma unidade (ou duas com o mesmo fator): devolve o valor intacto, sem
    // passar por uma divisão que só poderia introduzir erro de arredondamento.
    if (fromFactor.equals(toFactor)) {
      return parsedQuantity;
    }

    return parsedQuantity.mul(fromFactor).div(toFactor);
  }

  /** Converte para a base canônica da grandeza — o formato de armazenamento. */
  toBase(
    quantity: Prisma.Decimal | string | number,
    unit: ConvertibleUnit,
  ): Prisma.Decimal {
    return this.parseQuantity(quantity).mul(this.resolveFactor(unit));
  }

  /** Converte da base canônica para a unidade de exibição. */
  fromBase(
    quantity: Prisma.Decimal | string | number,
    unit: ConvertibleUnit,
  ): Prisma.Decimal {
    return this.parseQuantity(quantity).div(this.resolveFactor(unit));
  }

  areCompatible(from: ConvertibleUnit, to: ConvertibleUnit): boolean {
    return from.kind === to.kind;
  }

  assertCompatible(from: ConvertibleUnit, to: ConvertibleUnit): void {
    if (!this.areCompatible(from, to)) {
      throw new IncompatibleUnitsException(from, to);
    }
  }

  private parseQuantity(
    quantity: Prisma.Decimal | string | number,
  ): Prisma.Decimal {
    let parsed: Prisma.Decimal;

    try {
      parsed = new Prisma.Decimal(quantity);
    } catch {
      throw new InvalidQuantityException(quantity);
    }

    // Pega NaN e Infinity, que o construtor do Decimal aceita sem reclamar.
    if (!parsed.isFinite()) {
      throw new InvalidQuantityException(quantity);
    }

    if (parsed.isNegative()) {
      throw new NegativeQuantityException(quantity);
    }

    return parsed;
  }

  private resolveFactor(unit: ConvertibleUnit): Prisma.Decimal {
    if (unit.factorToBase === null || unit.factorToBase === undefined) {
      throw new PackagingUnitConversionException(unit);
    }

    let factor: Prisma.Decimal;

    try {
      factor = new Prisma.Decimal(unit.factorToBase);
    } catch {
      throw new InvalidConversionFactorException(unit);
    }

    if (!factor.isFinite() || factor.lte(0)) {
      throw new InvalidConversionFactorException(unit);
    }

    return factor;
  }
}
