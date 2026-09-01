import { Prisma, UnitKind } from '@prisma/client';

import {
  ConvertibleUnit,
  IncompatibleUnitsException,
  InvalidConversionFactorException,
  InvalidQuantityException,
  NegativeQuantityException,
  PackagingUnitConversionException,
  UnitConversionService,
} from './unit-conversion.service';

const unit = (
  code: string,
  kind: UnitKind,
  factorToBase: string | null,
): ConvertibleUnit => ({
  code,
  kind,
  factorToBase: factorToBase === null ? null : new Prisma.Decimal(factorToBase),
});

// Espelha o catálogo semeado pela migração.
const G = unit('G', UnitKind.WEIGHT, '1');
const KG = unit('KG', UnitKind.WEIGHT, '1000');
const MG = unit('MG', UnitKind.WEIGHT, '0.001');
const ML = unit('ML', UnitKind.VOLUME, '1');
const L = unit('L', UnitKind.VOLUME, '1000');
const UN = unit('UN', UnitKind.COUNT, '1');
const DZ = unit('DZ', UnitKind.COUNT, '12');
const CX = unit('CX', UnitKind.COUNT, null);

describe('UnitConversionService', () => {
  let service: UnitConversionService;

  beforeEach(() => {
    service = new UnitConversionService();
  });

  describe('massa', () => {
    it('converte KG para G', () => {
      expect(service.convert(10, KG, G).toString()).toBe('10000');
    });

    it('converte G para KG', () => {
      expect(service.convert(10000, G, KG).toString()).toBe('10');
    });

    it('converte KG para MG atravessando a base', () => {
      expect(service.convert(1, KG, MG).toString()).toBe('1000000');
    });

    it('converte MG para KG', () => {
      expect(service.convert(1000000, MG, KG).toString()).toBe('1');
    });
  });

  describe('volume', () => {
    it('converte L para ML', () => {
      expect(service.convert(2, L, ML).toString()).toBe('2000');
    });

    it('converte ML para L', () => {
      expect(service.convert(2500, ML, L).toString()).toBe('2.5');
    });
  });

  describe('contagem', () => {
    it('converte DZ para UN', () => {
      expect(service.convert(3, DZ, UN).toString()).toBe('36');
    });

    it('converte UN para DZ', () => {
      expect(service.convert(36, UN, DZ).toString()).toBe('3');
    });
  });

  describe('unidades incompatíveis', () => {
    it('recusa massa para contagem — 1 KG não é 1 UN', () => {
      expect(() => service.convert(1, KG, UN)).toThrow(
        IncompatibleUnitsException,
      );
    });

    it('recusa contagem para massa', () => {
      expect(() => service.convert(1, UN, KG)).toThrow(
        IncompatibleUnitsException,
      );
    });

    it('recusa massa para volume', () => {
      expect(() => service.convert(1, KG, L)).toThrow(
        IncompatibleUnitsException,
      );
    });

    it('recusa volume para contagem', () => {
      expect(() => service.convert(1, L, DZ)).toThrow(
        IncompatibleUnitsException,
      );
    });

    it('checa a compatibilidade antes de olhar o fator', () => {
      // CX não tem fator, mas o erro precisa ser o de grandeza incompatível:
      // é o diagnóstico correto para quem tentou converter caixa em quilo.
      expect(() => service.convert(1, KG, CX)).toThrow(
        IncompatibleUnitsException,
      );
    });

    it('areCompatible reflete a mesma regra sem lançar', () => {
      expect(service.areCompatible(KG, G)).toBe(true);
      expect(service.areCompatible(KG, UN)).toBe(false);
    });
  });

  describe('unidades de embalagem', () => {
    it('recusa converter caixa em unidade: o fator depende do insumo', () => {
      expect(() => service.convert(1, CX, UN)).toThrow(
        PackagingUnitConversionException,
      );
    });

    it('recusa converter unidade em caixa', () => {
      expect(() => service.convert(12, UN, CX)).toThrow(
        PackagingUnitConversionException,
      );
    });

    it('explica no erro por que não há fator universal', () => {
      expect(() => service.convert(1, CX, UN)).toThrow(/depends on the supply/);
    });
  });

  describe('valores decimais', () => {
    it('converte fração de KG sem perder casas', () => {
      expect(service.convert('0.001', KG, G).toString()).toBe('1');
    });

    it('converte 1 G para KG', () => {
      expect(service.convert(1, G, KG).toString()).toBe('0.001');
    });

    it('preserva precisão que o float perderia', () => {
      // 0.1 + 0.2 em float dá 0.30000000000000004. Com Decimal, 0.3 KG são
      // exatamente 300 G.
      expect(service.convert('0.3', KG, G).toString()).toBe('300');
      expect(service.convert('0.1', KG, G).plus(service.convert('0.2', KG, G)).toString()).toBe('300');
    });

    it('mantém as casas de uma quantidade longa', () => {
      expect(service.convert('1.23456789', KG, G).toString()).toBe('1234.56789');
    });

    it('aceita string, number e Decimal como entrada', () => {
      expect(service.convert('1.5', KG, G).toString()).toBe('1500');
      expect(service.convert(1.5, KG, G).toString()).toBe('1500');
      expect(service.convert(new Prisma.Decimal('1.5'), KG, G).toString()).toBe(
        '1500',
      );
    });

    it('converte zero', () => {
      expect(service.convert(0, KG, G).toString()).toBe('0');
    });
  });

  describe('quantidade inválida', () => {
    it('recusa quantidade negativa', () => {
      expect(() => service.convert(-1, KG, G)).toThrow(NegativeQuantityException);
    });

    it('recusa negativo mesmo em string', () => {
      expect(() => service.convert('-0.5', KG, G)).toThrow(
        NegativeQuantityException,
      );
    });

    it('recusa NaN', () => {
      expect(() => service.convert(NaN, KG, G)).toThrow(InvalidQuantityException);
    });

    it('recusa Infinity', () => {
      expect(() => service.convert(Infinity, KG, G)).toThrow(
        InvalidQuantityException,
      );
    });

    it('recusa texto que não é número', () => {
      expect(() => service.convert('dez quilos', KG, G)).toThrow(
        InvalidQuantityException,
      );
    });
  });

  describe('fator inválido', () => {
    it('recusa fator zero', () => {
      const quebrada = unit('X', UnitKind.WEIGHT, '0');
      expect(() => service.convert(1, quebrada, G)).toThrow(
        InvalidConversionFactorException,
      );
    });

    it('recusa fator negativo', () => {
      const quebrada = unit('X', UnitKind.WEIGHT, '-5');
      expect(() => service.convert(1, quebrada, G)).toThrow(
        InvalidConversionFactorException,
      );
    });
  });

  describe('toBase e fromBase', () => {
    it('toBase leva KG para gramas', () => {
      expect(service.toBase('2.5', KG).toString()).toBe('2500');
    });

    it('toBase é identidade na própria unidade base', () => {
      expect(service.toBase('700', G).toString()).toBe('700');
    });

    it('fromBase traz gramas de volta para KG', () => {
      expect(service.fromBase('2500', KG).toString()).toBe('2.5');
    });

    it('toBase e fromBase são inversos', () => {
      const original = '10';
      const emBase = service.toBase(original, KG);
      expect(service.fromBase(emBase, KG).toString()).toBe(original);
    });

    it('toBase recusa unidade de embalagem', () => {
      expect(() => service.toBase(1, CX)).toThrow(
        PackagingUnitConversionException,
      );
    });
  });

  describe('mesma unidade', () => {
    it('devolve a quantidade intacta', () => {
      expect(service.convert('33.7', KG, KG).toString()).toBe('33.7');
    });
  });

  describe('o caso do enunciado', () => {
    it('queijo com base em grama, comprado em 10 KG, vira 10.000 G', () => {
      const compra = new Prisma.Decimal('10');
      const emEstoque = service.toBase(compra, KG);

      expect(emEstoque.toString()).toBe('10000');
      expect(service.fromBase(emEstoque, KG).toString()).toBe('10');
    });
  });
});
