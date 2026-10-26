/* Banco Ladder — ejemplos precargados (Guía 1 "Contactos y bobinas" y temporizadores) */
(function (root) {
  'use strict';
  const EXAMPLES = [
    { id: 'g1e1', group: 'Guía 1', name: 'Ej. 1 · Contacto NA y bobina', code:
`# Guía 1 · Ejercicio 1
entrada I1 interruptor "Interruptor"
salida Q1 lampara "Lámpara"

I1 -> Q1
` },
    { id: 'g1e2', group: 'Guía 1', name: 'Ej. 2 · Contactos en serie', code:
`# Guía 1 · Ejercicio 2: Q3 activada por I2 y C1 en serie
entrada I2 interruptor "Entrada"
entrada C1 pulsador "Tecla de cursor"
salida Q3 lampara "Salida"

I2 & C1 -> Q3
` },
    { id: 'g1e3', group: 'Guía 1', name: 'Ej. 3 · Contactos en paralelo', code:
`# Guía 1 · Ejercicio 3: Q2 con I2 o la tecla C3
entrada I2 interruptor "Entrada"
entrada C3 pulsador "Tecla de cursor"
salida Q2 lampara "Salida"

I2 | C3 -> Q2
` },
    { id: 'g1e4', group: 'Guía 1', name: 'Ej. 4 · Marcha-parada directa', code:
`# Guía 1 · Ejercicio 4: marcha-parada directa
entrada I1 pulsador "Marcha"
entrada I2 pulsador "Parada"
entrada I3 interruptor "Relé térmico"
salida Q1 motor "Motor"

# Marcha con autorretención
(I1 | Q1) & /I2 & /I3 -> Q1
` },
    { id: 'g1e5', group: 'Guía 1', name: 'Ej. 5 · Inversión de giro', code:
`# Guía 1 · Ejercicio 5: inversión de giro con enclavamientos
entrada I1 pulsador "Giro adelante"
entrada I3 pulsador "Giro atrás"
entrada I2 pulsador "Parada"
salida Q1 motor "Contactor adelante"
salida Q3 motor "Contactor atrás"

# Adelante: enclavado con I3 y Q3
(I1 | Q1) & /I2 & /I3 & /Q3 -> Q1

# Atrás: enclavado con I1 y Q1
(I3 | Q3) & /I2 & /I1 & /Q1 -> Q3
` },
    { id: 'g1e6', group: 'Guía 1', name: 'Ej. 6 · Llaves de habilitación', code:
`# Guía 1 · Ejercicio 6: supervisor y dos encargados
entrada I1 interruptor "Llave supervisor"
entrada I2 interruptor "Llave encargado 1"
entrada I3 interruptor "Llave encargado 2"
salida Q1 lampara "Máquina 1"
salida Q2 lampara "Máquina 2"
salida Q3 lampara "Máquina 3"
salida Q4 lampara "Máquina 4"

# Máquina 1: cualquier llave
I1 | I2 | I3 -> Q1

# Máquina 2: supervisor, o los dos encargados
I1 | I2 & I3 -> Q2

# Máquina 3: al menos dos llaves
I1 & I2 | I1 & I3 | I2 & I3 -> Q3

# Máquina 4: supervisor y un encargado
I1 & (I2 | I3) -> Q4
` },
    { id: 'g1e7', group: 'Guía 1', name: 'Ej. 7 · Tanque y dos bombas', code:
`# Guía 1 · Ejercicio 7: tanque elevado con dos bombas
entrada I1 sensor "Tanque · nivel máximo"
entrada I2 sensor "Tanque · nivel mínimo"
entrada I3 sensor "Depósito 1 · mínimo"
entrada I4 sensor "Depósito 2 · mínimo"
salida Q1 motor "Bomba 1"
salida Q2 motor "Bomba 2"

# Bomba 1: depósito con agua y tanque no lleno
I3 & /I1 -> Q1

# Bomba 2: tanque bajo mínimo, o depósito 1 vacío
I4 & /I1 & (/I2 | /I3) -> Q2
` },
    { id: 'g1e8', group: 'Guía 1', name: 'Ej. 8 · Toldo y riego', code:
`# Guía 1 · Ejercicio 8: campo de cultivo
entrada I1 sensor "Humedad (H)"
entrada I2 sensor "Temperatura (T)"
entrada I3 sensor "Luminosidad (L)"
salida Q1 lampara "Toldo abierto"
salida Q2 lampara "Válvulas de riego"

# Toldo: /T·/H + L·/T = /T·(/H + L)
/I2 & (/I1 | I3) -> Q1

# Riego: /H + /T
/I1 | /I2 -> Q2
` },
    { id: 'g1e9', group: 'Guía 1', name: 'Ej. 9 · Relé autoenclavador', code:
`# Guía 1 · Ejercicio 9: marcha-parada con set/reset
entrada I1 pulsador "Marcha"
entrada I3 pulsador "Parada"
entrada I2 interruptor "Relé térmico"
salida Q2 motor "Motor"

# Set: marcha
I1 -> S Q2

# Reset: parada o térmico (va abajo, tiene prioridad)
I3 | I2 -> R Q2
` },
    { id: 'g1e10', group: 'Guía 1', name: 'Ej. 10 · Desviador de botellas', code:
`# Guía 1 · Ejercicio 10: una botella a cada empacadora
entrada I1 pulsador "Sensor de botella"
salida Q1 lampara "Desviador (activo = empacadora B)"

# Cada botella invierte el desviador
I1 -> T Q1
` },
    { id: 'g1e11', group: 'Guía 1', name: 'Ej. 11 · Luz con cuatro pulsadores', code:
`# Guía 1 · Ejercicio 11: telerruptor con cuatro pulsadores
entrada C1 pulsador "Pulsador 1"
entrada C2 pulsador "Pulsador 2"
entrada C3 pulsador "Pulsador 3"
entrada C4 pulsador "Pulsador 4"
salida Q1 lampara "Luz"

# Cualquier pulsador invierte la luz
C1 | C2 | C3 | C4 -> T Q1
` },
    { id: 'tof', group: 'Temporizadores y contadores', name: 'Luz de escalera (TOF)', code:
`# Luz de escalera: queda encendida 8 s después de soltar el pulsador
entrada I1 pulsador "Pulsador de escalera"
salida Q1 lampara "Luz"

# Retardo a la desconexión
I1 -> TOF T1 8s

T1 -> Q1
` },
    { id: 'ton', group: 'Temporizadores y contadores', name: 'Arranque estrella-triángulo (TON)', code:
`# Arranque estrella-triángulo: 5 s en estrella y después triángulo
entrada I1 pulsador "Marcha"
entrada I2 pulsador "Parada"
entrada I3 interruptor "Relé térmico"
salida Q1 motor "Contactor de línea"
salida Q2 lampara "Contactor estrella"
salida Q3 lampara "Contactor triángulo"

# Línea con autorretención y temporizador de cambio
(I1 | Q1) & /I2 & /I3 -> Q1, TON T1 5s

# Estrella hasta que vence T1
Q1 & /T1 & /Q3 -> Q2

# Triángulo después de T1
Q1 & T1 & /Q2 -> Q3
` },
    { id: 'ctu', group: 'Temporizadores y contadores', name: 'Cajas de 6 botellas (CTU)', code:
`# Avisa cuando se juntaron 6 botellas en la caja
entrada I1 pulsador "Sensor de botella"
entrada I2 pulsador "Caja retirada"
salida Q1 lampara "Caja completa"

# Cuenta botellas
I1 -> CTU CT1 6

# Caja completa al llegar a 6
CT1 -> Q1

# Al retirar la caja, el contador vuelve a 0
I2 -> R CT1
` },
    { id: 'tp', group: 'Temporizadores y contadores', name: 'Timbre de 2 segundos (TP)', code:
`# Un toque al pulsador hace sonar el timbre exactamente 2 s
entrada I1 pulsador "Pulsador"
salida Q1 lampara "Timbre"

I1 -> TP T1 2s

T1 -> Q1
` }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;
  else root.LadderExamples = EXAMPLES;
})(typeof window !== 'undefined' ? window : this);
