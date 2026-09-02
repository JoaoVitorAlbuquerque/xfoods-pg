import { ValidationPipe } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';

import { ConsumptionReportDto, PeriodGrouping } from './consumption-report.dto';

/**
 * A query string é a interface real destes relatórios, e tudo nela chega como
 * texto. O pipe do controller precisa converter `limit` para número e
 * `movementTypes` para lista antes do serviço — sem isso, `{ in: 'SALE,LOSS' }`
 * chegaria ao Prisma como string e quebraria em runtime, não na validação.
 */
describe('ConsumptionReportDto', () => {
  const pipe = new ValidationPipe({ transform: true });

  const parse = (query: Record<string, unknown>) =>
    pipe.transform(query, {
      type: 'query',
      metatype: ConsumptionReportDto,
    }) as Promise<ConsumptionReportDto>;

  it('converte limit de texto para número', async () => {
    const dto = await parse({ limit: '25' });

    expect(dto.limit).toBe(25);
  });

  it('aceita movementTypes separados por vírgula', async () => {
    const dto = await parse({ movementTypes: 'SALE,LOSS' });

    expect(dto.movementTypes).toEqual([
      StockMovementType.SALE,
      StockMovementType.LOSS,
    ]);
  });

  it('aceita o parâmetro repetido', async () => {
    const dto = await parse({ movementTypes: ['SALE', 'ADJUSTMENT'] });

    expect(dto.movementTypes).toEqual([
      StockMovementType.SALE,
      StockMovementType.ADJUSTMENT,
    ]);
  });

  it('normaliza espaços e caixa', async () => {
    const dto = await parse({ movementTypes: ' sale , loss ' });

    expect(dto.movementTypes).toEqual([
      StockMovementType.SALE,
      StockMovementType.LOSS,
    ]);
  });

  it('recusa tipo de movimentação inexistente', async () => {
    await expect(parse({ movementTypes: 'SALE,VOO' })).rejects.toThrow();
  });

  it('recusa uuid malformado', async () => {
    await expect(parse({ supplyId: 'nao-e-uuid' })).rejects.toThrow();
  });

  it('recusa data malformada', async () => {
    await expect(parse({ from: '31/12/2025' })).rejects.toThrow();
  });

  it('aceita o agrupamento por período', async () => {
    const dto = await parse({ groupBy: 'MONTH' });

    expect(dto.groupBy).toBe(PeriodGrouping.MONTH);
  });

  it('deixa tudo indefinido quando nada é informado', async () => {
    const dto = await parse({});

    expect(dto.from).toBeUndefined();
    expect(dto.movementTypes).toBeUndefined();
    expect(dto.limit).toBeUndefined();
  });

  /**
   * Justifica o `@UsePipes` do ConsumptionController.
   *
   * O pipe global do `main.ts` é `new ValidationPipe()`, sem `transform`. Ele
   * valida sobre a instância convertida mas devolve a query original, então o
   * handler receberia `movementTypes` como texto — passaria na validação e
   * quebraria depois, dentro do Prisma. Ligar `transform` no pipe global
   * mudaria o comportamento de todas as rotas antigas de uma vez; ligar por
   * controller resolve só onde é preciso.
   */
  it('o pipe global, sem transform, devolveria a query crua', async () => {
    const global = new ValidationPipe();

    const result = (await global.transform(
      { movementTypes: 'SALE,LOSS', limit: '25' },
      { type: 'query', metatype: ConsumptionReportDto },
    )) as Record<string, unknown>;

    expect(result.movementTypes).toBe('SALE,LOSS');
    expect(result.limit).toBe('25');
  });
});
