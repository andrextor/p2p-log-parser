# @p2p/log-parser

Librería Node en TypeScript estricto que convierte los logs de las aplicaciones
de Placetopay en eventos estructurados, listos para dibujar en una línea de
tiempo.

El principio de diseño es uno: **si el dato se puede derivar del log, lo deriva
el parser, no la capa visual.** El consumidor no debería tener que volver a
recorrer el payload para saber si una operación falló, a qué sesión pertenece o
cuánto tardó.

## Qué entrega

Cada evento llega con la información ya resuelta:

- **`correlation`** — los identificadores del flujo (traza, sesión, transacción,
  referencia, proveedor, operación, tenant, login, BIN) extraídos según el
  contrato de cada emisor, no adivinando rutas en el payload.
- **`outcome`** — si la operación falló y por qué: excepción de transporte,
  rechazo de negocio del proveedor, código HTTP o validación de la petición.
- **`pairKey` / `pairRole` / `durationMs`** — la ida y la vuelta de un mismo
  intercambio, unidas y medidas.
- **`ts`** — epoch ms en UTC, para ordenar y agrupar sin volver a parsear fechas
  ni suponer zonas horarias.
- **`stats`** por lote y **metadata** por dominio.

### Sobre datos sensibles

Esta librería **no enmascara nada**. Los valores sensibles ya llegan
enmascarados desde el origen: las aplicaciones usan `maskValue` y `secureValue`
antes de escribir el log, y los números de tarjeta viajan cifrados. El parser
los preserva tal cual los recibe.

## Instalación

```bash
pnpm add @andrextor_ia11012/p2p-log-parser
```

## Uso

```typescript
import { P2PParserEngine, AppTypes, matchEvent } from "@andrextor_ia11012/p2p-log-parser";

const engine = new P2PParserEngine();
const result = engine.parse(rawLogContent, AppTypes.REST);

for (const event of result.events) {
  if (event.outcome?.isError) {
    // kind: "exception" | "business" | "http" | "validation"
    console.log(event.outcome.kind, event.outcome.code, event.outcome.message);
  }

  if (event.durationMs) {
    console.log(`${event.message} tardó ${event.durationMs} ms`);
  }
}

// Seguir una traza: compara el id del evento, todos sus identificadores de
// correlación y la clave del intercambio.
const trace = result.events.filter((e) => matchEvent(e, "115551128"));

// Resumen del lote, sin recorrer los eventos otra vez.
console.log(result.stats);
// { total, byApp, byCategory, byLevel, errorCount, unrecognized, timespan }
```

`result.metadata` es una unión discriminada por aplicación: `sessions[]` en
Checkout, `requestsByProvider` / `errors` / `slowest` en REST.

## Formatos soportados

| Aplicación | Formato |
|---|---|
| REST | Export CSV de New Relic Logs; registros JSON de New Relic; líneas de Laravel |
| Checkout | CSV de AWS CloudWatch, CSV y JSON de Grafana, CloudWatch Insights, líneas de Laravel |
| Microsites | Líneas de Laravel (mapper genérico) |

`engine.getSupportedFormats()` devuelve la lista con su regla de detección.

Dentro de esos formatos se reconocen los emisores reales: el contexto
Atropos/Tangram de los SDK de proveedor, `HTTP Req`/`HTTP Res`/`HTTP Except`/
`HTTP Stats` de `guzzle-logger`, el log HTTP entrante del middleware
`HttpLogger`, el carrier SOAP heredado, `placetopay_event` y `placetopay_log` de
Checkout, y las trazas con prefijo `«{sujeto} trace:»`.

## Extensión

```typescript
const engine = new P2PParserEngine({
  customRestActions: {
    // Sobrescribe la etiqueta de una operación, o añade una nueva
    refund: { message: "Devolución", category: "PAYMENT", source: "BACKEND" },
  },
  customCheckoutActions: {
    entry: { message: "Mi entrada", category: "BROWSER_LOAD", source: "FRONTEND" },
  },
});
```

También se exportan las piezas para escribir mappers propios: `buildEventBase`,
`buildCorrelation`, `resolveOutcome`, `toEpochMs`, `matchEvent`,
`LaravelLineParser` y los catálogos `REST_OPERATION_LABELS` y
`CHANNEL_PROVIDERS`.

## Migrar desde 1.x

- `LogMapper.isMatch` ya no existe: usar `matchEvent(event, id)`.
- `statusCode` ya no se inventa. Donde antes había un `200` o `500` fabricado
  ahora puede haber `null`; para saber si algo falló, usar `outcome.isError`.
- `NormalizedLogData.level` es `LogLevel`, no `string`.
- `buildEventId(ctx, index)` pasa a `buildEventId(ctx, seed)`.
- `CheckoutLocalParser` se elimina en favor de `LaravelLineParser`.
- `RestParseMetadata` cambia de forma y `CheckoutMetadataExtractor` devuelve
  metadata también con una sola sesión.
- Los mensajes de los eventos REST cambian al usar el catálogo real de
  operaciones.

El detalle completo está en el [CHANGELOG](CHANGELOG.md).

## Desarrollo

```bash
pnpm install
pnpm run test:run   # vitest
pnpm run lint       # biome
pnpm run build      # tsc && vite build
```

## Licencia

Confidencial — Propiedad de Placetopay (Evertec).
