# Banco Ladder

Simulador online de diagramas **Ladder (KOP)** para aprender PLC. El mismo programa se puede crear de dos formas, y las dos están siempre sincronizadas:

- **Con código**: un lenguaje de texto simple que dibuja el diagrama al instante.
- **Arrastrando componentes**: contactos, bobinas, temporizadores y contadores que se sueltan sobre el diagrama.

El programa se simula en vivo, con ciclo de scan como un PLC real.

## Funciones

- Editor de código con resaltado, números de línea y errores en español que indican la línea.
- Editor visual: soltá un contacto a la izquierda o a la derecha de otro para ponerlo en serie, o debajo para ponerlo en paralelo. Las bobinas van en la zona de la derecha. Tocá un elemento para editarlo o borrarlo.
- Simulación RUN / STOP, paso a paso y reinicio.
- Pulsadores, interruptores y sensores. En modo **Operar** se accionan tocando los contactos del diagrama.
- Temporizadores TON, TOF y TP, contador CTU, set/reset y relé de impulsos.
- Tabla de verdad automática para programas sin memoria.
- **Proyectos guardados** en el navegador con autoguardado, para retomar donde lo dejaste.
- **Archivos `.ladder`** para guardar y abrir proyectos en otra computadora.
- Exportación del diagrama como imagen SVG.
- Ejemplos: los 11 ejercicios de la Guía 1 "Contactos y bobinas", y más ejemplos con temporizadores y contadores.

## Lenguaje

Cada línea es una red: `condición -> bobina`. El comentario anterior (`# …`) es el título de la red.

```text
entrada I1 pulsador "Marcha"
entrada I2 pulsador "Parada"
entrada I3 interruptor "Relé térmico"
salida Q1 motor "Motor"

# Marcha con autorretención
(I1 | Q1) & /I2 & /I3 -> Q1
```

| Escribís | Significa |
|---|---|
| `I1 & I2` · `I1 I2` · `I1 AND I2` | Serie (Y) |
| `I1 \| I2` · `I1 + I2` · `I1 OR I2` | Paralelo (O) |
| `/I2` · `!I2` · `NOT I2` | Contacto normalmente cerrado |
| `-> Q1` · `-> /Q1` | Bobina común · bobina negada |
| `-> S Q1` · `-> R Q1` | Set · reset |
| `-> T Q1` | Relé de impulsos |
| `-> TON T1 5s` · `TOF` · `TP` | Temporizadores (contacto `T1`) |
| `-> CTU CT1 6` · `-> R CT1` | Contador y su reset (contacto `CT1`) |
| `-> Q1, TON T1 5s` | Varias bobinas en paralelo |

La negación de un paréntesis se convierte a contactos NC con De Morgan, así que todo se puede dibujar.

## Usarlo

- **Online**: con GitHub Pages activado, en `https://<usuario>.github.io/banco-ladder/`.
- **En tu computadora**: abrí `index.html` en el navegador. No hace falta instalar nada.

## Estructura

```text
index.html        página
css/styles.css    estilos (modo claro y oscuro)
js/core.js        lenguaje, compilador y simulación (sin dependencias)
js/examples.js    ejemplos precargados
js/storage.js     proyectos en el navegador y archivos .ladder
js/app.js         interfaz, editor visual y simulación en vivo
tests/            tests del núcleo
```

## Tests

Requiere Node.js 18 o superior:

```bash
node --test tests/core.test.js
```

## Licencia

MIT
