import { StockLevelService, StockStatus } from './stock-level.service';

describe('StockLevelService', () => {
  let service: StockLevelService;

  beforeEach(() => {
    service = new StockLevelService();
  });

  const status = (
    currentStock: string,
    minStock = '0',
    maxStock: string | null = null,
  ) => service.getStatus({ currentStock, minStock, maxStock });

  describe('classificação', () => {
    it('marca saldo negativo', () => {
      expect(status('-1.5', '10')).toBe(StockStatus.NEGATIVE);
    });

    it('marca saldo zerado', () => {
      expect(status('0', '10')).toBe(StockStatus.ZERO);
    });

    it('marca abaixo do mínimo', () => {
      expect(status('9.999', '10')).toBe(StockStatus.LOW);
    });

    it('trata exatamente no mínimo como abaixo — é hora de comprar', () => {
      expect(status('10', '10')).toBe(StockStatus.LOW);
    });

    it('marca acima do máximo', () => {
      expect(status('120', '10', '100')).toBe(StockStatus.OVER);
    });

    it('não alerta quando está dentro da faixa', () => {
      expect(status('50', '10', '100')).toBe(StockStatus.OK);
    });

    it('exatamente no máximo ainda é OK', () => {
      expect(status('100', '10', '100')).toBe(StockStatus.OK);
    });
  });

  describe('mínimo zero significa "não acompanho"', () => {
    it('saldo positivo com mínimo zero não vira alerta', () => {
      // Sem esta regra, todo insumo cadastrado sem mínimo viveria em LOW e o
      // painel de alertas deixaria de servir para alguma coisa.
      expect(status('0.001', '0')).toBe(StockStatus.OK);
    });

    it('mas zerado continua sendo zerado', () => {
      expect(status('0', '0')).toBe(StockStatus.ZERO);
    });
  });

  describe('precedência entre situações', () => {
    it('negativo vence abaixo do mínimo', () => {
      expect(status('-5', '10')).toBe(StockStatus.NEGATIVE);
    });

    it('zerado vence abaixo do mínimo', () => {
      expect(status('0', '10')).toBe(StockStatus.ZERO);
    });

    it('ordena o painel do mais grave para o menos grave', () => {
      const ordenado = [
        StockStatus.OK,
        StockStatus.LOW,
        StockStatus.NEGATIVE,
        StockStatus.OVER,
        StockStatus.ZERO,
      ].sort((a, b) => service.severity(a) - service.severity(b));

      expect(ordenado).toEqual([
        StockStatus.NEGATIVE,
        StockStatus.ZERO,
        StockStatus.LOW,
        StockStatus.OVER,
        StockStatus.OK,
      ]);
    });
  });

  describe('needsAttention', () => {
    it('é verdadeiro para tudo que não é OK', () => {
      expect(service.needsAttention({ currentStock: '0', minStock: '0' })).toBe(true);
      expect(service.needsAttention({ currentStock: '-1', minStock: '0' })).toBe(true);
      expect(service.needsAttention({ currentStock: '5', minStock: '10' })).toBe(true);
    });

    it('é falso quando está tudo certo', () => {
      expect(service.needsAttention({ currentStock: '50', minStock: '10' })).toBe(false);
    });
  });

  describe('shortfall', () => {
    it('diz quanto falta para voltar ao mínimo', () => {
      expect(
        service.shortfall({ currentStock: '3.5', minStock: '10' }).toString(),
      ).toBe('6.5');
    });

    it('conta o negativo dentro da falta', () => {
      expect(
        service.shortfall({ currentStock: '-2', minStock: '10' }).toString(),
      ).toBe('12');
    });

    it('é zero quando não falta nada', () => {
      expect(
        service.shortfall({ currentStock: '50', minStock: '10' }).toString(),
      ).toBe('0');
    });

    it('não perde casas decimais', () => {
      expect(
        service.shortfall({ currentStock: '0.1', minStock: '0.3' }).toString(),
      ).toBe('0.2');
    });
  });
});
