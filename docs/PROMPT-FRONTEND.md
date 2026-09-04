# PROMPT — Front-end dos módulos de estoque, custos, preço e indicadores

Implemente no front-end (`fe/`) as telas dos dez módulos entregues na API
(`api-pg`). O back-end está completo, testado e em produção de desenvolvimento;
nada nele precisa mudar para este trabalho.

---

## 1. Contexto

A API ganhou, em dez fases, um sistema integrado de estoque, custos e
rentabilidade. **Nenhuma tela foi feita** — o front-end atual conhece apenas
categorias, produtos, pedidos e leads.

| Fase | Módulo | Estado da API |
|---|---|---|
| 1 | Unidades de medida e conversão | ✅ |
| 2 | Insumos e estoque (razão append-only) | ✅ |
| 3 | Compras, fornecedores e histórico de custo | ✅ |
| 4 | Fichas técnicas versionadas | ✅ |
| 5 | Baixa automática na venda | ✅ |
| 6 | Consumo estimado × real | ✅ |
| 7 | Despesas e rateio de custo indireto | ✅ |
| 8 | Formação de preço | ✅ |
| 9 | Indicadores e dashboards | ✅ |
| 10 | Sub-receitas e produção | ✅ |

**Escopo deste prompt:** só o front-end. Não altere a API, o schema Prisma nem
as migrações. Se encontrar um comportamento que pareça errado, registre e
pergunte — não contorne no cliente.

---

## 2. Stack e convenções

O projeto já usa, e você deve seguir:

- **React 18 + TypeScript + Vite**
- **TanStack Query v5** para todo estado de servidor — nada de `useEffect` +
  `useState` para buscar dados
- **axios** com a instância e o interceptor de auth já existentes
- **react-hook-form + zod** para formulários e validação
- **Tailwind CSS** com `clsx` / `tailwind-merge`
- **Radix UI** (`@radix-ui/react-select`, `react-popover`) e **Headless UI**
- **react-router-dom v6**
- **react-hot-toast** para feedback
- **react-number-format** para entrada de dinheiro e quantidade
- **date-fns** para datas
- **socket.io-client** para o realtime de pedidos, que já existe

**Antes de escrever qualquer componente**, leia o código atual e reproduza os
padrões que encontrar: estrutura de pastas, nomes de hooks, camada de
`services`, tipos, tratamento de erro, layout e tokens de Tailwind. Este
documento diz **o que** construir; o **como** vem do projeto.

---

## 3. Contrato da API

### 3.1 Autenticação

Todas as rotas exigem `Authorization: Bearer <token>`, exceto `POST /auth/sign-in`
e `POST /users`. O interceptor atual já cuida disso.

### 3.2 Números decimais

**Toda coluna decimal chega como `number` no JSON, nunca como string.** Existe um
interceptor global (`DecimalSerializerInterceptor`) que garante isso. Não
converta com `Number(...)` nem `parseFloat` "por garantia" — se um valor vier
string, é bug da API e deve ser reportado.

Ao **enviar** quantidades e dinheiro, prefira **string** (`"12.54"`) a number.
Os DTOs aceitam os dois, mas string atravessa sem passar por float e preserva
a precisão. Use `react-number-format` com `valueIsNumericString`.

### 3.3 Períodos

Os relatórios de custo (Fases 7 a 10) aceitam `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
**Ausentes, o padrão é o mês corrente** (competência). A exceção é
`/consumption/*`, cujo padrão são os últimos 30 dias.

Datas de competência são **data pura em UTC** — não aplique fuso ao exibir
`startDate`, `endDate`, `competenceDate` ou `period.from` / `period.to`.

### 3.4 Erros

| Status | Significado | Tratamento na UI |
|---|---|---|
| 400 | Validação (DTO ou regra de negócio) | Mostrar `message` — costuma ser um array |
| 401 | Token inválido/expirado | Fluxo de logout já existente |
| 404 | Não encontrado, ou pré-condição ausente | Mensagem explica o motivo, use-a |
| **409** | **Conflito de estado** | **Ver seção 4** — quase sempre exige UI própria |
| 501 | Método configurado mas não implementado | Mostrar `message` e apontar a configuração |

As mensagens de erro da API são escritas para serem lidas por humanos e dizem
o caminho da correção. **Exiba `error.response.data.message`**, não uma string
genérica.

### 3.5 Um bug conhecido

`GET /stock/movements?limit=N` **retorna 500**. O `ValidationPipe` global não
converte tipos, então `limit` chega como texto e o Prisma recusa. A correção é
no back-end e já está mapeada.

**Enquanto não for corrigida:** não envie `limit` nem `offset` para
`/stock/movements`. Pagine no cliente ou aguarde o ajuste. Os módulos novos
(`/consumption`, `/pricing`, `/analytics`) têm pipe próprio e aceitam `limit`
normalmente.

---

## 4. As sete regras de ouro

A API foi construída para **nunca mentir em silêncio**. Vários endpoints
devolvem, junto do resultado, um aviso de que o número não é confiável ou de que
a leitura tem uma ressalva. **Se a interface descartar esses campos, o sistema
inteiro passa a mentir** — e com a autoridade de uma tela bonita.

Estas sete regras não são preferências de UX. São requisitos.

### 4.1 `caveats`, `warnings`, `notes` e `alerts` são conteúdo, não metadado

Vários endpoints devolvem arrays de string explicando o que ficou de fora, o que
foi estimado ou o que mudou. Todos precisam aparecer na tela — como faixa de
aviso, nota de rodapé do relatório ou item de lista, mas **visíveis**.

Onde aparecem:

| Endpoint | Campo | O que dizem |
|---|---|---|
| `PATCH /orders/paid` | `alerts[]` | Prato vendido sem ficha; insumo sem custo |
| `GET /consumption/*` | `interpretation.caveats[]` | Filtro que distorceu a comparação |
| `GET /cost-allocation` | `caveats[]` | Estimativa não configurada; janela multiplicada |
| `GET /cost-allocation/full-cost` | `notes[]` | Nada foi somado ao preço de venda |
| `PUT /expenses/:id` | `warnings[]` | O valor alterado reescreveu meses passados |
| `GET /pricing/*` | `notes[]` | Preço é sugestão; margem é sobre o preço |
| `GET /analytics/*` | `caveats[]`, `dataQuality.warning` | Custo direto incompleto |

### 4.2 `dataQuality` decide se o painel pode ser levado a sério

`GET /analytics/overview` e `/analytics/costs` devolvem:

```json
"dataQuality": {
  "itemsWithCostSnapshot": 120,
  "itemsWithoutCostSnapshot": 46,
  "costCoveragePercent": 72.29,
  "warning": "46 item(ns) vendido(s) sem custo congelado: ..."
}
```

Vendas anteriores à baixa automática e pratos sem ficha não têm custo
congelado. Quando `costCoveragePercent < 100`, **o custo direto está
subestimado e a margem, superestimada**.

Mostre a cobertura ao lado da margem — badge, barra, o que for — e nunca
apresente uma margem de 45% sem dizer que ela foi calculada sobre 72% das
vendas. As 22 vendas históricas do banco de desenvolvimento caem exatamente
nesse caso.

### 4.3 Preço recomendado nunca é aplicado sozinho

`GET /pricing/products/:id` devolve `recommendedPrice` e sugestões de
arredondamento. **Nenhuma rota altera `products.price`.**

Aplicar um preço é uma ação deliberada do usuário: botão explícito, confirmação,
e a alteração vai pelo endpoint de produto que já existe. Não pré-preencha o
campo de preço com o recomendado sem o usuário pedir.

### 4.4 Fechar a conta pode ser recusado por falta de insumo

Com `allowNegativeStock: false` (o padrão), `PATCH /orders/paid` retorna **409**
quando falta insumo, e **o pagamento não é confirmado** — a transação inteira
volta atrás.

Isso acontece com um cliente esperando na mesa. O tratamento não pode ser um
toast vermelho genérico. Precisa de:

- mensagem dizendo **qual insumo** faltou e quanto (vem no `message`)
- caminho de saída visível: ir ao ajuste de estoque, ou ligar
  `allowNegativeStock` em `/stock/settings`
- garantia visual de que a conta **não** foi fechada

O mesmo vale para 409 de `allowSaleWithoutRecipe: false` (prato sem ficha).

### 4.5 Existe venda paga **e** cancelada

Cancelar um pedido pago estorna o estoque mas **mantém `paid: true` e `paidAt`**
— o sistema não tem conceito de devolução de dinheiro.

Não assuma `status === 'CANCELED'` ⇒ não pago. Qualquer soma de faturamento no
cliente precisa filtrar `status !== 'CANCELED'`, como a API faz. Prefira usar os
totais que a API já calcula a somar no front.

### 4.6 Diferença entre estimado e real **não** é desperdício

`GET /consumption/*` devolve `interpretation.possibleCauses` com sete causas
possíveis (desperdício, erro de lançamento, inventário, produção, perdas,
ajustes, consumo não registrado) e um `warning` explícito.

Esse bloco precisa estar na tela do relatório — não escondido atrás de um "?".
Use também `deviationBreakdown.documented` / `.undocumented`: quando o desvio é
inteiramente explicado por perdas já lançadas, a tela deve dizer isso, não
sugerir investigação.

### 4.7 Custo congelado e custo atual são números diferentes

Dois conceitos que não podem se misturar:

- **Custo realizado** — congelado na venda (`recipeTotalCost`). É o que o prato
  custou naquele dia. Base dos relatórios de rentabilidade.
- **Custo atual** — recalculado pela ficha com o preço de hoje. Base do preço
  recomendado.

`GET /analytics/products/:id` devolve `unitEconomics.costBasis` como
`REALIZED` ou `CURRENT_RECIPE`. Rotule na tela. "Custo" sem qualificação, ao
lado de dois números diferentes, é o caminho mais curto para o usuário
desconfiar do sistema inteiro.

---

## 5. Módulos a construir

### 5.1 Unidades de medida (Fase 1)

**Endpoints:** `GET|POST /measurement-units`, `PUT|DELETE /measurement-units/:id`,
`POST /measurement-units/convert`

Não tem tela própria — entrega **componentes reutilizáveis** que os outros
módulos consomem:

- `<UnitSelect />` — carrega as unidades (sistema + do usuário), agrupadas por
  grandeza (`kind`: WEIGHT / VOLUME / COUNT). Aceita filtrar por grandeza, para
  o formulário de ficha só oferecer unidades compatíveis com o insumo.
- `<QuantityInput />` — quantidade + unidade num campo só, com `react-number-format`.
- `<BaseQuantityHint />` — mostra a conversão em tempo real: digitar `10 KG` num
  insumo com base em grama exibe *"= 10.000 g"*. É o que evita o erro de
  digitar quilo achando que é grama.

**Regras que a UI deve respeitar:**

- Unidades de sistema (`isSystem: true`) não são editáveis nem removíveis —
  KG, G, L, ML e UN são constantes físicas.
- Unidades de embalagem (`isPackaging: true`, `factorToBase: null`) **não podem
  ser unidade base de insumo** e não convertem sozinhas. Desabilite-as no
  seletor de unidade base, com tooltip explicando.
- Contagem nunca converte para massa ou volume. O seletor filtrado por `kind`
  já impede; se um 400 escapar, a mensagem explica.

Uma tela simples de CRUD de unidades personalizadas em Configurações resolve
o resto.

---

### 5.2 Insumos e estoque (Fase 2)

**Endpoints:**

```
GET    /supplies                    lista (search, supplyCategoryId, active, stockStatus)
GET    /supplies/:id                detalhe + últimas 10 movimentações
POST   /supplies                    cadastro (com saldo inicial opcional)
PUT    /supplies/:id
PATCH  /supplies/:id/active
GET|POST|PUT|DELETE /supply-categories

GET    /stock                       posição de todos os insumos
GET    /stock/alerts                só o que precisa de atenção
GET    /stock/movements             extrato (⚠️ não envie limit — ver 3.5)
GET|PUT /stock/settings
POST   /stock/entries               entrada manual
POST   /stock/exits                 saída manual
POST   /stock/losses                perda (exige motivo)
POST   /stock/adjustments           ajuste por saldo absoluto

GET|POST /stock-counts              inventários
GET    /stock-counts/:id
PATCH  /stock-counts/:id/apply
PATCH  /stock-counts/:id/cancel
```

**Telas:**

1. **Lista de insumos** — busca, filtro por categoria, por situação e por ativo.
   Cada linha traz `stockStatus`, `currentStock`, `minStock` e `stockValue`.
2. **Cadastro / edição** — nome, categoria, **unidade base** (com o aviso de que
   ela define como todo saldo é guardado), mínimo, máximo opcional, saldo
   inicial opcional com custo.
3. **Painel de estoque** — `GET /stock`, ordenado do mais grave ao normal, com o
   resumo (`negative`, `zero`, `low`, `over`, `totalValue`).
4. **Extrato de movimentações** — filtros por insumo, tipo e período. Mostre
   `direction` (derivado do sinal), `balanceAfter` e `reason`.
5. **Operações** — entrada, saída, perda e ajuste. Modais curtos.
6. **Inventário** — contagem por insumo, aplicar gera `ADJUSTMENT`.
7. **Configurações de estoque** — os três campos de `/stock/settings`.

**Situações de estoque** (`stockStatus`), na ordem de gravidade:

| Valor | Significado | Sugestão visual |
|---|---|---|
| `NEGATIVE` | Saldo abaixo de zero | Vermelho, ícone de alerta |
| `ZERO` | Zerado | Vermelho claro |
| `LOW` | No mínimo ou abaixo | Âmbar |
| `OVER` | Acima do máximo | Azul (capital parado) |
| `OK` | Normal | Neutro |

> `minStock: 0` significa *"não acompanho mínimo deste insumo"*, não *"o mínimo
> é zero"*. Não pinte de âmbar um insumo sem mínimo definido.

**Toda alteração de saldo gera movimentação.** Não existe "editar saldo" — o
caminho é ajuste ou inventário. A UI não deve oferecer campo de saldo editável
na edição de insumo.

---

### 5.3 Compras e custo (Fase 3)

**Endpoints:**

```
GET|POST /purchases
GET    /purchases/:id
PATCH  /purchases/:id/confirm
PATCH  /purchases/:id/cancel
GET|POST|PUT|DELETE /suppliers
GET    /supply-costs/report          variação de preço
GET    /supply-costs/:supplyId/history
```

**Telas:**

1. **Lista de compras** — status (`DRAFT` / `CONFIRMED` / `CANCELED`),
   fornecedor, data, total.
2. **Nova compra** — fornecedor opcional, número da nota, data de emissão,
   e uma tabela de itens: insumo, quantidade, unidade, preço total. A UI deve
   exibir o **custo por unidade base** calculado (`10 KG por R$ 350` →
   `R$ 0,035/g`) — é o número que torna compras comparáveis.
3. **Detalhe** — itens, custo unitário base e a variação contra a compra
   anterior, congelada na confirmação.
4. **Variação de preço** — `GET /supply-costs/report`, com `direction`
   (`UP` / `DOWN` / `FLAT` / `null`). Colunas: insumo, custo anterior, custo
   atual, data, variação %.
5. **Histórico por insumo** — linha do tempo append-only.

**Estados:**

- Rascunho **não encosta no estoque**. Deixe isso óbvio na tela — badge, e o
  botão de confirmar como ação primária.
- Confirmar é irreversível: `PATCH /cancel` numa compra confirmada retorna
  **409**. Peça confirmação antes.
- `variationPercent: null` significa primeira compra do insumo. Mostre "—", não
  "0%".

---

### 5.4 Ficha técnica (Fase 4)

**Endpoints:**

```
GET    /recipes                      lista (productId, type=PRODUCT|SUB, active)
GET    /recipes/cost-report          custo direto de todos os pratos
GET    /recipes/missing              produtos sem ficha ativa
GET    /recipes/product/:productId/active
GET    /recipes/:id                  com custo calculado
POST   /recipes
PUT    /recipes/:id
POST   /recipes/:id/new-version
PATCH  /recipes/:id/activate
PATCH  /recipes/:id/deactivate
```

**Tela principal: seção de ficha técnica no formulário de produto.**

Tabela de itens, exatamente como o escopo pediu:

| Insumo | Quantidade | Unidade | Custo unitário | Custo total |
|---|---|---|---|---|
| Queijo | 200 | G | R$ 0,035 | R$ 7,00 |
| Calabresa | 250 | G | R$ 0,028 | R$ 7,00 |

E, embaixo: **Custo direto estimado do prato: R$ 14,00**.

**Componentes de comportamento:**

- Um item é **insumo OU sub-receita**, nunca os dois. Alterne com um seletor.
- **Perda de preparo** (`wastePercent`) segue a convenção de ficha técnica:
  é quanto se perde do que entra, então 200 g líquidos com 10% de perda exigem
  **222,22 g** brutos. Mostre a quantidade bruta calculada ao lado do campo —
  senão o usuário vai achar que são 220 g.
- **Fatores de tamanho** (`sizeFactors`): multiplicador por tamanho vendido.
  `TINY` (broto), `SMALL`, `MEAN`, `LARGE`, `EXTRA_LARGE` (gigante), `METER`.
  Tamanho sem fator vale 1. Uma tabelinha de tamanho × fator resolve.
- **Versionamento**: só uma versão ativa por prato. Nova versão nasce inativa —
  criar não troca a ficha que está valendo. Lista de versões com data, custo e
  botão de ativar.
- `hasMissingCost: true` significa que a ficha usa insumo nunca comprado: o
  custo está subestimado. Badge de aviso, não erro.

**Tela de cobertura:** `GET /recipes/missing` lista produtos vendáveis sem ficha
ativa, com `coveragePercent`. É o relatório que impede o estoque de mentir em
silêncio — merece destaque no menu, não só um link.

---

### 5.5 Venda e baixa de estoque (Fase 5)

Não é tela nova — são **ajustes nas telas de pedido que já existem**.

**`PATCH /orders/paid` mudou de retorno:**

```json
{ "updated": 1, "stockMovements": 5, "alerts": [ ... ] }
```

O front atual ignora o retorno, então não quebra. Mas agora:

- Se `alerts` tiver itens, mostre-os (ver regra 4.1). São do tipo `NO_RECIPE`
  (prato vendido sem ficha, nada foi consumido) ou `MISSING_COST` (ficha usa
  insumo nunca comprado, custo subestimado).
- Se retornar **409**, aplique a regra 4.4 — a conta **não** foi fechada.

**Novo endpoint:** `GET /orders/:orderId/consumption` devolve o que a venda
consumiu, o que voltou e o saldo líquido por insumo. Vale um painel lateral ou
aba no detalhe do pedido: *"o que este pedido tirou do estoque"*.

**Cancelamento** (`PATCH /orders/:orderId/cancel`) agora estorna o estoque com
movimentações `RETURN` e devolve `stockReversal`. Ver regra 4.5 sobre o
pagamento continuar marcado.

---

### 5.6 Estimado × real (Fase 6)

**Endpoints:**

```
GET /consumption/by-supply         estimado × real por insumo
GET /consumption/by-product        o mesmo, por prato
GET /consumption/deviations        maiores desvios (%)
GET /consumption/financial-losses  maiores perdas (R$)
GET /consumption/waste-by-period   desperdício por dia/semana/mês
GET /consumption/dashboard         painel
```

**Filtros comuns:** `from`, `to`, `productId`, `categoryId`, `supplyId`,
`supplyCategoryId`, `movementTypes` (aceita `SALE,LOSS`), `limit`,
`groupBy` (`DAY` | `WEEK` | `MONTH`).

**Colunas do relatório por insumo:**

| Insumo | Estimado | Real | Diferença | Variação % | Custo do desvio | Situação |
|---|---|---|---|---|---|---|
| Calabresa | 25.000 g | 27.000 g | +2.000 g | +8% | R$ 56,00 | `ACIMA_DO_ESPERADO` |

**Classificação** (`classification`): `ABAIXO_DO_ESPERADO`,
`DENTRO_DA_TOLERANCIA`, `ACIMA_DO_ESPERADO`. A tolerância vem de
`/stock/settings` (`stockConsumptionTolerancePercentage`, padrão 5%) e volta em
`summary.tolerancePercent`.

**Dois casos que a UI precisa tratar:**

- `variationPercent: null` — o estimado é zero, então não existe porcentagem.
  Mostre "—" e destaque a linha: consumir um insumo que nenhuma venda previa é
  o desvio mais grave que existe, e a API já o classifica como
  `ACIMA_DO_ESPERADO`.
- `deviationBreakdown` — separa o desvio em `documented` (perdas, ajustes,
  produção e transferências já lançados) e `undocumented`. Quando
  `undocumented === 0`, o desvio está inteiramente explicado. Diga isso.

Aplique a regra 4.6: o bloco `interpretation` vai na tela.

---

### 5.7 Despesas e rateio (Fase 7)

**Endpoints:**

```
GET|POST /expenses
GET    /expenses/occurrences        extrato de competências
GET    /expenses/summary            total por categoria/tipo/periodicidade
GET|PUT|DELETE /expenses/:id
PATCH  /expenses/:id/activate
PATCH  /expenses/:id/deactivate
GET|POST /expense-categories
POST   /expense-categories/seed     cria as 12 categorias sugeridas
PUT    /expense-categories/:id
GET|PUT /cost-allocation/settings
GET    /cost-allocation             custo indireto e custo por unidade
GET    /cost-allocation/full-cost   custo completo por produto
```

**Telas:**

1. **Cadastro de despesa** — descrição, categoria, tipo (`FIXED` / `VARIABLE`),
   valor, **periodicidade** (`ONCE` / `DAILY` / `WEEKLY` / `MONTHLY` / `YEARLY`),
   data inicial, data final opcional, `includeInAllocation`, observação.

   > O campo mais importante é a **data inicial**: é competência, não cadastro.
   > Uma despesa lançada hoje pode valer desde janeiro. Deixe isso explícito no
   > rótulo ou no helper text.

2. **Listagem** com filtros: busca, categoria, tipo, periodicidade, ativo e
   **vigência** (`from`/`to` — traz quem vigorava na janela, não quem foi
   cadastrado nela).

3. **Extrato de competências** — `GET /expenses/occurrences`: cada repetição da
   regra vira uma linha datada. É o que prova ao usuário que o aluguel de março
   está sendo contado sem ele lançar nada.

4. **Configuração de rateio** — método (só `PER_SOLD_UNIT` funciona;
   `BY_REVENUE` e `MANUAL` retornam **501** no cálculo), período de referência,
   vendas estimadas, e os dois switches de tipo.

5. **Visão de custos operacionais** — `GET /cost-allocation`:

   ```
   Aluguel     R$ 5.000
   Água        R$   800
   Energia     R$ 2.000
   Gás         R$ 1.000
   Internet    R$   200
   ─────────────────────
   Total       R$ 9.000
   ÷ 3.000 unidades estimadas
   = R$ 3,00 por unidade
   ```

   Mostre também `costPerUnitByActualSales` — o mesmo cálculo com o volume que
   realmente saiu. É o teste da estimativa, e a divergência vem em `caveats`.

6. **Custo completo por produto** — `GET /cost-allocation/full-cost`:
   custo direto + indireto rateado. Destaque `summary.belowFullCost` (pratos
   cujo preço não cobre o custo completo) e `summary.productsWithoutRecipe`.

**Dois comportamentos que a UI precisa comunicar:**

- **Desativar preserva o passado.** Desligar o aluguel hoje não zera o custo de
  janeiro. O botão pode dizer "parar de repetir" em vez de "desativar".
- **Alterar o valor reescreve o passado.** O `PUT` devolve `warnings[]` quando
  isso acontece. Mostre o aviso e ofereça o caminho certo: encerrar com
  `endDate` e cadastrar outra a partir da nova vigência.

---

### 5.8 Formação de preço (Fase 8)

**Endpoints:**

```
GET|PUT /pricing/settings
GET    /pricing/products             cardápio: atual × recomendado
GET    /pricing/products/:productId  detalhe completo
GET    /pricing/simulate             cenários (?productId ou ?cost)
```

**Telas:**

1. **Configuração** — margem desejada, impostos, taxa de cartão, taxa de
   delivery, outras taxas. `configured: false` significa que ninguém configurou
   ainda (imposto e taxa nascem em zero de propósito). Se `configured` for
   falso, mostre um convite para configurar antes de confiar no recomendado.

2. **Detalhe do prato** — a tela central da fase:

   ```
   Custo direto      R$  4,40
   Custo indireto    R$  3,00
   ─────────────────────────
   Custo completo    R$  7,40

   Impostos    6%    Taxas    5%    Margem   30%
   ─────────────────────────
   Preço atual       R$ 11,90
   Preço recomendado R$ 12,54
   Diferença        -R$  0,64   ⚠ Preço abaixo do recomendado.
   ```

   Abaixo, a **rentabilidade** nos dois preços (`profitability.atCurrentPrice` e
   `.atRecommendedPrice`): preço, custo, impostos, taxas, lucro, margem. As
   parcelas somam exatamente o preço — uma barra empilhada funciona bem.

   > O número que justifica o alerta não é a diferença de R$ 0,64, é a margem:
   > **26,81% contra os 30% pedidos**. Dê a ele o mesmo peso visual.

3. **Arredondamento** — `roundingSuggestions[]`, cada uma com o preço, a
   diferença contra o recomendado e **a margem que ela realmente entrega**:

   | Preço | Diferença | Margem |
   |---|---|---|
   | R$ 12,50 | −0,04 | 29,76% |
   | R$ 12,90 | +0,36 | 31,63% |
   | R$ 13,00 | +0,46 | 32,08% |

   Sem a coluna de margem a escolha vira estética. Botão de aplicar por linha —
   e ver regra 4.3.

4. **Simulador** — tabela de cenários de margem. `viable: false` significa que
   a combinação estoura 100%; mostre a linha com o motivo, não a esconda.

5. **Lista do cardápio** — `GET /pricing/products` com `status`
   (`ABAIXO_DO_CUSTO`, `ABAIXO_DO_RECOMENDADO`, `NO_RECOMENDADO`,
   `ACIMA_DO_RECOMENDADO`). `ABAIXO_DO_CUSTO` é um problema diferente e mais
   grave: ali vender mais aumenta a perda.

**Sobrescrita por canal:** qualquer percentual pode ir na query
(`?cardFeePercent=0`) sem gravar nada. Um seletor "Balcão / Delivery" que ajusta
as taxas é um recurso barato e muito útil. `percentages.source` diz de onde veio
cada número (`SETTINGS` ou `QUERY`).

**Segurança:** impostos + taxas + margem ≥ 100% retorna **400** com a mensagem
*"Não é possível calcular o preço"*. Valide no cliente também, para o usuário
ver o limite antes de submeter.

---

### 5.9 Indicadores e dashboards (Fase 9)

**Endpoints:**

```
GET /analytics/overview             indicadores gerais
GET /analytics/products             ranking (rankBy, limit, offset)
GET /analytics/products/:productId  o prato inteiro
GET /analytics/alerts               os seis alertas
GET /analytics/stock                painel de estoque
GET /analytics/costs                painel de custos
```

Todos aceitam `from`, `to`, `productId`, `categoryId`, `supplyId`,
`supplyCategoryId`.

**1. Painel principal** (`/overview`):

```
Faturamento       R$ 400,00       Valor de estoque  R$ 312,50
Custo direto      R$ 100,00       Desperdício       R$  17,50
Custo indireto    R$  75,00
Custo total       R$ 175,00
Lucro estimado    R$ 181,00
Margem                 45,25%
```

Mais `indirectAbsorption`: quanto da despesa do período as vendas **não**
absorveram. Ratear R$ 3/un esperando 3.000 vendas e vender 2.000 deixa
R$ 3.000 sem absorver — despesa real que não aparece no custo de produto nenhum.
Sem esse número na tela, o lucro do painel parece maior que o do caixa.

**2. Rankings** (`/products?rankBy=`): `REVENUE`, `PROFIT`, `MARGIN_HIGH`,
`MARGIN_LOW`, `COST`, `QUANTITY`. Seis abas ou um seletor. Eles **discordam
entre si** de propósito — o prato que mais fatura raramente é o que mais lucra.

**3. Detalhe do prato** (`/products/:id`) — preço atual, custo direto, custo
indireto, custo total, taxas, impostos, lucro, margem, preço recomendado,
quantidade vendida e faturamento, tudo na mesma tela. Ver regra 4.7 sobre
`costBasis`.

**4. Alertas** (`/alerts`) — seis listas:

- produtos abaixo da margem desejada
- produtos abaixo do preço recomendado
- produtos sem ficha técnica
- produtos com custo elevado
- insumos com aumento significativo
- insumos com desperdício elevado

Limiares configuráveis na query: `highCostThresholdPercent` (35),
`costIncreaseThresholdPercent` (10), `wasteThresholdCost` (0). São referências
do setor, não regras — deixe o usuário ajustar.

> Os dois primeiros parecem o mesmo alerta e não são: **margem abaixo da
> desejada** olha o que já foi vendido; **preço abaixo do recomendado** olha a
> tabela de preços contra o custo de hoje. Um prato pode estar no preço certo e
> render pouco, se o insumo encareceu depois. Rotule os dois com clareza.

**5. Painel de estoque** (`/stock`) — valor total, contagens por situação,
maiores consumos, maiores perdas, consumo por tipo de movimentação.

**6. Painel de custos** (`/costs`) — custo total, custo médio por unidade,
estimado × real em dinheiro, desperdício e variação de custos.

**Performance:** os endpoints agregam no banco e devolvem uma linha por produto.
Não busque venda a venda para somar no cliente — o custo já vem pronto. Use
`staleTime` generoso no TanStack Query (5 min é razoável para painel).

---

### 5.10 Sub-receitas e produção (Fase 10)

**Endpoints:**

```
GET|POST /production-orders
GET    /production-orders/yield-report
GET    /production-orders/:id
PATCH  /production-orders/:id/confirm
PATCH  /production-orders/:id/cancel
```

**Conceito que a UI precisa deixar claro:** uma sub-receita tem **dois modos**,
decididos pelo campo `outputSupplyId` na ficha.

| | Sem insumo de saída | Com insumo de saída |
|---|---|---|
| O que é | composição de custo | subproduto **estocado** |
| Na venda | desdobra até tomate e cebola | consome o molho |
| Quem repõe | a compra dos ingredientes | a ordem de produção |

**Telas:**

1. **Ficha de sub-receita** — igual à ficha de prato, mais: nome, rendimento
   (quantidade + unidade) e um seletor opcional de **insumo de saída**.
   Ao marcar, explique o que muda: *"o molho passa a ter saldo próprio e
   precisará ser produzido"*.

   Restrições: só sub-receita pode ter insumo de saída, e a grandeza da unidade
   base do insumo precisa bater com a do rendimento (400 caso contrário).

2. **Nova ordem de produção** — escolher a sub-receita, número de lotes, e uma
   prévia dos ingredientes que serão consumidos (derivada da ficha). Permita
   **editar as quantidades** — a produção registra o que aconteceu, não o que
   estava planejado.

3. **Confirmação** — o passo que pede o **rendimento real**:

   ```
   Rendimento esperado   10.000 g
   Rendimento real        8.000 g   ← informado pelo usuário
   Diferença             -2.000 g (80%)
   Custo por grama       R$ 0,0075  (era R$ 0,006)
   ```

   Deixe visível que um lote que rendeu menos **encarece a unidade** — é o que
   faz a perda de produção chegar ao preço do prato.

4. **Lista de lotes** com status (`DRAFT` / `CONFIRMED` / `CANCELED`) e filtros
   por sub-receita, insumo de saída e período.

5. **Relatório de rendimento** (`/yield-report`) — previsto × real lote a lote,
   com `lostValue` (custo dos ingredientes que não viraram produto). Se todo
   lote sai abaixo, a ficha está errada, não a cozinha.

**Estados:**

- Rascunho não encosta no estoque.
- Confirmar é uma transação só: se faltar insumo, retorna **409** e **nada** se
  move — nem o tomate que já teria saído. O lote continua rascunho e pode ser
  confirmado depois da reposição. Diga isso na mensagem de erro.
- Cancelar lote **confirmado** retorna 409: as movimentações são históricas. O
  caminho é ajuste ou perda, e a mensagem da API já explica.

---

## 6. Ordem de implementação sugerida

Cada etapa entrega algo utilizável e destrava a seguinte.

| # | Etapa | Por quê primeiro |
|---|---|---|
| 1 | Componentes de unidade (5.1) | Todo formulário depende deles |
| 2 | Insumos + estoque (5.2) | Sem insumo cadastrado nada mais funciona |
| 3 | Compras (5.3) | É o que dá custo aos insumos |
| 4 | Ficha técnica (5.4) | Precisa de insumo com custo |
| 5 | Ajustes na venda (5.5) | Pequeno, e liga o estoque à operação |
| 6 | Despesas + rateio (5.7) | Independente; destrava custo completo |
| 7 | Formação de preço (5.8) | Precisa de ficha e de rateio |
| 8 | Dashboards (5.9) | Consome tudo acima |
| 9 | Estimado × real (5.6) | Só faz sentido com histórico de vendas |
| 10 | Produção (5.10) | O mais nichado; deixe por último |

As etapas 1 a 4 são o caminho crítico. Depois delas o sistema já é útil, mesmo
sem os painéis.

---

## 7. Checklist de aceitação

Antes de considerar cada módulo pronto:

- [ ] Nenhum `caveat`, `warning`, `note` ou `alert` da API está sendo descartado
- [ ] `dataQuality.costCoveragePercent < 100` aparece ao lado de qualquer margem
- [ ] Nenhuma tela altera preço de venda sem ação explícita do usuário
- [ ] O 409 de estoque insuficiente ao fechar a conta tem tratamento próprio,
      com o insumo faltante e o caminho de saída
- [ ] Nenhuma soma de faturamento no cliente ignora `status === 'CANCELED'`
- [ ] O bloco de causas possíveis aparece no relatório de estimado × real
- [ ] Custo realizado e custo atual estão rotulados onde aparecem juntos
- [ ] Decimais não passam por `Number()` nem `parseFloat` desnecessários
- [ ] Quantidades e valores são enviados como string
- [ ] `limit` não é enviado para `/stock/movements` (bug aberto)
- [ ] Estados de rascunho estão visualmente distintos dos confirmados
- [ ] Toda ação irreversível (confirmar compra, confirmar produção, ativar
      ficha) pede confirmação
- [ ] Vazio, carregando e erro têm tratamento em todas as listas
- [ ] Responsivo: as tabelas largas rolam horizontalmente sem quebrar a página

---

## 8. Regras de trabalho

- **Preserve todas as funcionalidades atuais.** Pedidos, produtos, categorias e
  leads continuam funcionando como estão.
- **Não faça refatoração grande por preferência arquitetural.** Priorize:
  compatibilidade, integridade dos dados, baixo acoplamento, evolução
  incremental.
- **Não altere a API.** Se algo faltar no contrato, registre e pergunte.
- Se um comportamento da API parecer errado, **não contorne no cliente** — um
  contorno no front esconde o problema e cria uma segunda fonte de verdade.

---

*Documento gerado a partir da implementação das Fases 1 a 10 da `api-pg`.
Rotas conferidas contra os controllers em 02/09/2026.*
