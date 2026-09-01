import { Prisma } from '@prisma/client';
import { registerDecorator, ValidationOptions } from 'class-validator';

function parse(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  try {
    const parsed = new Prisma.Decimal(value);

    // O construtor do Decimal aceita NaN e Infinity sem reclamar.
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Aceita number ou string decimal. Enviar string preserva a precisão — um
 * number em JSON já chegou como float, e é essa perda que o módulo de estoque
 * existe para evitar em quantidades e custos.
 */
export function IsDecimalLike(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDecimalLike',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => parse(value) !== null,
        defaultMessage: () =>
          `${propertyName} must be a finite decimal (send it as a string to preserve precision)`,
      },
    });
  };
}

export function IsNonNegativeDecimal(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNonNegativeDecimal',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => {
          const parsed = parse(value);
          return parsed !== null && !parsed.isNegative();
        },
        defaultMessage: () =>
          `${propertyName} must be a finite decimal greater than or equal to zero`,
      },
    });
  };
}

export function IsPositiveDecimal(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPositiveDecimal',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => {
          const parsed = parse(value);
          return parsed !== null && parsed.gt(0);
        },
        defaultMessage: () =>
          `${propertyName} must be a finite decimal greater than zero`,
      },
    });
  };
}
