import { Prisma } from '@prisma/client';

import {
  InvalidWastePercentException,
  RecipeCostingService,
} from './recipe-costing.service';

describe('RecipeCostingService', () => {
  let service: RecipeCostingService;

  beforeEach(() => {
    service = new RecipeCostingService();
  });

  describe('custo do item', () => {
    it('calcula o exemplo do enunciado: 200 g de queijo a R$ 0,035/g', () => {
      const custo = service.itemCost('200', 0, '0.035');

      expect(custo.totalCost.toString()).toBe('7');
      expect(custo.effectiveQuantity.toString()).toBe('200');
    });

    it('calcula 250 g de calabresa a R$ 0,028/g', () => {
      expect(service.itemCost('250', 0, '0.028').totalCost.toString()).toBe('7');
    });

    it('soma o custo direto dos itens', () => {
      const itens = [
        service.itemCost('200', 0, '0.035'),
        service.itemCost('250', 0, '0.028'),
        service.itemCost('100', 0, '0.012'),
      ];

      expect(service.sum(itens).toString()).toBe('15.2');
    });

    it('recusa quantidade zero', () => {
      expect(() => service.itemCost('0', 0, '1')).toThrow(/greater than zero/);
    });

    it('recusa quantidade negativa', () => {
      expect(() => service.itemCost('-5', 0, '1')).toThrow(/greater than zero/);
    });

    it('não perde precisão em custos de fração de centavo', () => {
      // Em float, 0.035 * 200 dá 7.000000000000001.
      expect(service.itemCost('200', 0, '0.035').totalCost.toString()).toBe('7');
      expect(service.itemCost('3', 0, '0.1').totalCost.toString()).toBe('0.3');
    });
  });

  describe('percentual de perda', () => {
    it('sem perda, a quantidade bruta é a líquida', () => {
      expect(service.effectiveQuantity('200', 0).toString()).toBe('200');
    });

    it('10% de perda exige partir de 222,22 g para render 200 g', () => {
      // Convenção de ficha técnica: a perda é sobre o que ENTRA. Usar
      // 200 × 1,10 = 220 subestimaria o consumo em toda saída de estoque.
      expect(service.effectiveQuantity('200', '10').toFixed(2)).toBe('222.22');
    });

    it('20% de perda dobra o custo pela metade certa', () => {
      expect(service.effectiveQuantity('80', '20').toString()).toBe('100');
    });

    it('50% de perda dobra a quantidade', () => {
      expect(service.effectiveQuantity('100', '50').toString()).toBe('200');
    });

    it('a perda encarece o item na mesma proporção', () => {
      const semPerda = service.itemCost('100', 0, '0.05');
      const comPerda = service.itemCost('100', '20', '0.05');

      expect(semPerda.totalCost.toString()).toBe('5');
      expect(comPerda.totalCost.toString()).toBe('6.25');
    });

    it('aceita perda fracionada', () => {
      expect(service.effectiveQuantity('100', '2.5').toFixed(4)).toBe('102.5641');
    });

    it('recusa perda de 100% — exigiria quantidade infinita', () => {
      expect(() => service.effectiveQuantity('100', '100')).toThrow(
        InvalidWastePercentException,
      );
    });

    it('recusa perda acima de 100%', () => {
      expect(() => service.effectiveQuantity('100', '150')).toThrow(
        InvalidWastePercentException,
      );
    });

    it('recusa perda negativa', () => {
      expect(() => service.effectiveQuantity('100', '-10')).toThrow(
        InvalidWastePercentException,
      );
    });

    it('recusa perda não numérica', () => {
      expect(() => service.effectiveQuantity('100', 'muita')).toThrow(
        InvalidWastePercentException,
      );
    });
  });

  describe('custo por unidade de rendimento', () => {
    it('divide o custo direto pelo rendimento', () => {
      // Molho que custa R$ 40 e rende 2000 ML sai a R$ 0,02/ML.
      expect(
        service
          .costPerYieldUnit(new Prisma.Decimal('40'), '2000')
          .toString(),
      ).toBe('0.02');
    });

    it('rendimento 1 devolve o próprio custo direto', () => {
      expect(
        service.costPerYieldUnit(new Prisma.Decimal('15.2'), 1).toString(),
      ).toBe('15.2');
    });

    it('recusa rendimento zero', () => {
      expect(() =>
        service.costPerYieldUnit(new Prisma.Decimal('10'), 0),
      ).toThrow(/greater than zero/);
    });
  });

  describe('a pizza do enunciado', () => {
    it('soma massa, extrato, queijo, presunto e calabresa', () => {
      const itens = [
        service.itemCost('1', 0, '3.5'), // 1 massa a R$ 3,50
        service.itemCost('100', 0, '0.008'), // 100 g extrato
        service.itemCost('200', 0, '0.035'), // 200 g queijo
        service.itemCost('200', 0, '0.03'), // 200 g presunto
        service.itemCost('250', 0, '0.028'), // 250 g calabresa
      ];

      // 3,50 + 0,80 + 7,00 + 6,00 + 7,00
      expect(service.sum(itens).toString()).toBe('24.3');
    });
  });
});
