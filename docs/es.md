# Blueair

Siga y controle sus **purificadores de aire Blueair** desde Gladys: calidad
del aire (PM2.5, PM10, COV), vida útil del filtro, encendido, velocidad del
ventilador, modos auto / noche / eco, brillo de la pantalla y bloqueo infantil
— a través de la nube Blueair, la misma que usa la aplicación Blueair. Reciba
un aviso una sola vez cuando un filtro deba cambiarse, y ponga todos los
purificadores en modo noche con un toque a la hora de dormir.

> **Desarrollada sin el hardware: sus comentarios son bienvenidos.** Esta
> integración se construyó y probó con respuestas reales de la nube Blueair
> registradas por los proyectos libres
> [blueair_api](https://github.com/dahlb/blueair_api) y
> [ha_blueair](https://github.com/dahlb/ha_blueair), no con un purificador ni
> con una cuenta. Si algo no funciona como se describe, indíquelo en el
> [foro de Gladys](https://community.gladysassistant.com) o en las
> [issues](https://github.com/guim31/gladys-blueair/issues).

Sin relación con Blueair ni con Unilever, que no la respaldan ni le dan
soporte. Blueair es una marca de su propietario.

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Un purificador Blueair conectado al Wi-Fi y configurado en la **aplicación
  Blueair** (Blue Pure Max, Protect, DustMagnet, HealthProtect, Signature,
  Classic, 2 en 1…).
- El **correo electrónico y la contraseña** de su cuenta Blueair, y su
  **región** (la elegida al crear la cuenta).
- Una conexión a Internet: todo pasa por la nube Blueair, no hay control local
  de los dispositivos Blueair.

## Puesta en marcha

1. Instale la integración desde el catálogo de Gladys.
2. En **Configuración**, introduzca el **Correo electrónico de la cuenta
   Blueair**, la **Contraseña de la cuenta Blueair** y la **Región de la
   cuenta** (Europa, América del Norte, Australia, China).
3. Guarde y pulse **Probar la conexión**: el mensaje bajo el botón lista los
   dispositivos de la cuenta.
4. Abra la pestaña **Descubrir**: un dispositivo por cada dispositivo Blueair
   de la cuenta. Pulse **Añadir**, elija una habitación y guarde.

Opciones:

- **Intervalo de actualización**: la frecuencia de lectura de los
  dispositivos, de 1 a 5 minutos (2 minutos por defecto).
- **Filtro por cambiar al**: la vida útil restante (5, 10, 15 o 20 %, 10 % por
  defecto) a la que el filtro debe cambiarse.
- **Idioma de los nombres de funciones**: inglés, francés, alemán o español.
  Los nombres se asignan al añadir un dispositivo (francés por defecto).

La contraseña solo se envía a Blueair. La integración guarda la sesión de
Blueair en `/data`: un reinicio no vuelve a iniciar sesión en la cuenta.

## El dispositivo de cada purificador

### Funciones

Cada función solo aparece si el dispositivo la tiene.

| Función                  | Qué es                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| Encendido                | Interruptor: encendido, el purificador funciona; apagado, en espera           |
| Velocidad del ventilador | La velocidad manual, dentro de los límites del modelo (véase abajo)           |
| Modo                     | Manual, Automático, Noche, Eco (Eco solo en la serie Signature)               |
| Brillo de la pantalla    | Brillo de la pantalla y las luces, 0–100 (0–4 en los modelos Classic)         |
| Bloqueo infantil         | Bloquea los botones del purificador                                           |
| Vida útil del filtro     | Vida útil restante del filtro, en %                                           |
| Filtro por cambiar       | 1 cuando la vida útil restante alcanza el umbral de la configuración          |
| PM2.5                    | Partículas finas, µg/m³                                                       |
| PM10                     | Partículas gruesas, µg/m³                                                     |
| COV                      | Compuestos orgánicos volátiles, ppb (Protect, HealthProtect, Classic serie i) |
| CO2                      | Dióxido de carbono, ppm (Classic serie i)                                     |
| Temperatura              | °C, en los modelos con el sensor                                              |
| Humedad                  | %, en los modelos con el sensor                                               |
| Conectado                | 1 cuando el purificador está conectado a la nube Blueair                      |

Elegir una velocidad pasa el purificador al modo manual, como hace la
aplicación. Las partículas se muestran como en la aplicación Blueair (la nube
las envía 1,32 veces más altas; la integración las corrige como ha_blueair).
Las PM1 no se publican: Gladys no tiene sensor de PM1.

### Modelos

- **Límites de la velocidad**: 0–91 en los modelos de cuatro velocidades (Blue
  Pure Max, Protect, 2 en 1), 0–100 en los demás, 1–3 en los
  humidificadores, 0–3 en los Classic de la nube antigua (0 es apagado).
- **ComfortPure 3 en 1 (T10i, T20i)**: estos dispositivos calientan. Son de
  **solo lectura** en Gladys (calidad del aire, temperatura, filtro): una
  escena errónea nunca debe dejar una calefacción encendida. Contrólelos con
  la aplicación Blueair.
- **Modelos antiguos** (Classic 205/280i/290i/480i/680i, Sense+): están en la
  nube antigua de Blueair y se encuentran con la misma cuenta. Su filtro solo
  indica «por cambiar» o no, sin porcentaje.
- Los humidificadores de la cuenta también aparecen, con su encendido,
  velocidad, modos y sensores.

## Widget del panel

El widget **Purificadores Blueair**, dos presentaciones:

- **todos los dispositivos** (ningún dispositivo elegido en su configuración):
  una línea por dispositivo — su modo y sus PM2.5, en verde, naranja o rojo
  según la calidad del aire, «Filtro por cambiar» llegado el momento,
  «Desconectado» si no está conectado — y dos botones, **Todo en auto** y
  **Todo en noche**;
- **un dispositivo**: mosaicos en directo (PM2.5, vida útil del filtro,
  temperatura o COV), su modo, su filtro, su conexión, y botones: **Apagar** /
  **Encender** y sus modos (Automático, Noche, Eco). El modo actual lleva una
  marca.

## Escenas

### Disparador

**Filtro Blueair por cambiar**: una vez por filtro, cuando su vida útil
restante alcanza el umbral de la configuración (o cuando un Classic antiguo
indica que su filtro debe cambiarse). No una segunda vez para el mismo filtro,
ni siquiera tras un reinicio; una vez cambiado el filtro, se avisará del
siguiente. Filtro: un dispositivo (vacío: todos). Información transmitida:
nombre del dispositivo, modelo, vida útil restante (%).

### Acción

**Elegir el modo Blueair**: pone un dispositivo, o todos los que ofrecen el
modo (dispositivo vacío), en modo Automático, Noche, Eco o Manual. Devuelve el
número de dispositivos cambiados.

Las funciones de los dispositivos también se usan directamente en las
escenas: encender o apagar un purificador, ajustar su velocidad, o iniciar una
escena cuando las PM2.5 superan un valor.

### Ideas de escenas

- **Hora de dormir**: a las 22:30, _Elegir el modo Blueair_ → Noche, todos los
  dispositivos. Por la mañana, vuelta a Automático.
- **Recordatorio del filtro**: disparador _Filtro Blueair por cambiar_ →
  enviar un mensaje «Cambie el filtro de {nombre del dispositivo} (queda un
  {vida útil restante} %)».
- **Humo en la cocina**: cuando las PM2.5 del purificador de la cocina superan
  35 µg/m³, velocidad al máximo; vuelta a Automático cuando bajan de 10.
- **Casa vacía**: cuando no queda nadie, apagar los purificadores; al volver,
  encenderlos en Automático.

## Actualización y límites de la nube Blueair

Blueair no publica ninguna cuota para su nube. La integración se mantiene
ligera:

- una solicitud por dispositivo en cada actualización (de 1 a 5 minutos, 2
  por defecto);
- los valores de calidad del aire son medias de 5 minutos en el lado de
  Blueair: se leen como máximo una vez cada 5 minutos;
- la lista de dispositivos se vuelve a leer cada 6 horas (o con **Buscar** en
  la pestaña Descubrir);
- el inicio de sesión se guarda en `/data` y se renueva desde la sesión, sin
  volver a enviar la contraseña;
- una contraseña rechazada detiene toda solicitud hasta que cambie la
  configuración (los intentos repetidos bloquearían la cuenta); una respuesta
  «demasiadas solicitudes» lo suspende todo durante 10 minutos.

Gladys no consulta estos dispositivos: la integración los actualiza con su
propio temporizador. Los cambios hechos en la aplicación Blueair aparecen en
Gladys en la siguiente actualización.

## Solución de problemas

- **«correo electrónico o contraseña rechazados por Blueair»**: compruébelos
  en la aplicación Blueair y vuelva a guardar la configuración (hasta entonces
  la integración deja de intentarlo).
- **«abra una vez la aplicación Blueair y complete su perfil (nombre)»**:
  Blueair exige ahora un nombre en la cuenta. Abra la aplicación, complete el
  perfil y pulse **Probar la conexión**.
- **Conectado, pero ningún dispositivo**: la región probablemente es
  incorrecta; pruebe la otra (las cuentas creadas en el Reino Unido suelen
  estar en «Europa»).
- **Un purificador aparece «Desconectado»**: compruebe su Wi-Fi en la
  aplicación Blueair. La nube Blueair a veces indica como desconectado un
  purificador que funciona: los valores recientes de los sensores cuentan como
  señal de vida.
- **Los valores no cambian**: la calidad del aire solo cambia cada 5 minutos en
  el lado de Blueair.
- **Registros**: `LOG_LEVEL=debug` muestra cada solicitud (nunca la contraseña
  ni los tokens).

## Límites

- Solo nube: sin control local, y nada funciona sin Internet o cuando la nube
  Blueair falla.
- Sin tiempo real: los cambios aparecen en la siguiente actualización (el MQTT
  que usa la aplicación no está implementado).
- Las calefacciones ComfortPure 3 en 1 son de solo lectura. Sus modos de
  calefacción y refrigeración no se muestran.
- Las PM1, el germ shield, la luz nocturna, el temporizador y la mecha de los
  humidificadores no se publican.
- Las cuentas cuyos dispositivos están en otra región que la propia cuenta
  (poco frecuente) no son compatibles.
- Desarrollada sin el hardware: las familias de modelos siguen blueair_api y
  ha_blueair, construidos con dispositivos reales. Sus comentarios son
  bienvenidos.
