// The whitepaper, Spanish. Section ids and block shapes mirror en.ts exactly -
// tests/whitepaper.spec.ts holds all ten languages to the same outline.
//
// Register: plain, spoken Spanish. Short sentences, everyday words.

import { callout, facts, formula, h3, ol, p, steps, table, ul } from './model.ts';
import type { Whitepaper } from './model.ts';

export const es: Whitepaper = {
    meta:
    {
        title: 'Nura Swap',
        subtitle: 'Documento técnico',
        version: 'Documento técnico v1.2',
        date: 'Septiembre de 2026',
        covers: 'Describe la versión 1.3.0 de la aplicación en Nura Chain (id de cadena 1020).',
        abstractTitle: 'En pocas palabras',
        disclaimerTitle: 'Léelo, por favor',
        disclaimer: 'Este documento explica cómo funciona Nura Swap y qué esperamos construir después. No es asesoramiento financiero. No es una oferta de venta. No promete ninguna ganancia. Operar y poner dinero en un pool tienen riesgo real, y puedes perder todo lo que pongas. Los planes que aparecen aquí son intenciones, no promesas, y pueden cambiar.'
    },
    abstract: [
        'Nura Swap es una máquina de operar que vive en Nura Chain. Cambia un token por otro y nadie se pone en medio. Ninguna empresa guarda tu dinero. Nadie te aprueba. No hay cuenta que abrir. Tus monedas se quedan en tu propia cartera todo el tiempo.',
        'El truco es el pool. Un pool es una olla compartida con dos clases de token dentro, y calcula su propio precio con lo que tiene. Quien pone tokens en la olla gana una pequeña comisión de cada operación que pasa por ella. Esa es toda la idea. El resto del documento son los detalles.',
        'Nura Swap tiene tres piezas: contratos en la cadena que hacen el intercambio, un servidor pequeño que guarda precios e historial, y esta web, que puedes leer en diez idiomas. La Parte I explica cómo funciona la máquina. La Parte II explica cómo pensamos pagarla y hacerla crecer.'
    ],
    parts: [
        {
            id: 'protocol',
            label: 'Parte I',
            title: 'Cómo funciona el exchange',
            lede: 'Empieza por la olla de tokens y lo demás sale solo.',
            sections: [
                {
                    id: 'introduction',
                    title: 'Por qué una cadena necesita una máquina de intercambio',
                    blocks: [
                        p('Una cadena nueva es como un pueblo nuevo. Las monedas existen, pero no hay dónde intercambiarlas, así que nadie sabe cuánto valen. Alguien tiene que abrir una tienda.'),
                        p('La tienda de toda la vida es el libro de órdenes: una lista larga de gente que quiere comprar y gente que quiere vender. Solo funciona si hay alguien al otro lado justo cuando tú quieres operar. Y normalmente hace falta una empresa que guarde el dinero de todos mientras se cruzan las órdenes. En una cadena joven casi nunca hay nadie al otro lado. Y entregarle tus monedas a una empresa es justo lo que una blockchain viene a evitar.'),
                        p('Nura Swap lo hace al revés. En lugar de emparejar a dos personas, mantiene una olla con dos clases de token dentro. Tú operas con la olla. Metes un token, sacas el otro, y la olla calcula el precio sola. Está siempre abierta, nunca dice que no, y no guarda nada tuyo más tiempo del que dura tu operación.'),
                        p('Las matemáticas de dentro de la olla no son nuestras. Nura Swap ejecuta UniswapV3 tal cual está escrito: el código más usado y más revisado de su clase. Lo que hemos construido es todo lo que lo rodea para esta cadena: el despliegue, los datos de precios, la web en diez idiomas y el plan de la Parte II.')
                    ]
                },
                {
                    id: 'nura-chain',
                    title: 'Nura Chain en una página',
                    blocks: [
                        p('Nura Chain es la red sobre la que corre todo esto. Escribe un bloque nuevo cada tres segundos más o menos, y en cuanto está escrito ya está: no hay que esperar a ver si se queda. Así que tu intercambio termina en el momento en que aparece su bloque. La cadena habla el mismo idioma que Ethereum, así que las carteras y herramientas hechas para Ethereum funcionan aquí sin cambiar nada.'),
                        facts(
                            { label: 'Id de cadena', value: '1020', mono: true },
                            { label: 'Su moneda', value: 'NURA (18 decimales)', mono: true },
                            { label: 'Versión envuelta', value: 'WNURA, siempre 1:1', mono: true },
                            { label: 'Cómo se acuerdan los bloques', value: 'CometBFT: un bloque escrito es definitivo' },
                            { label: 'Un bloque nuevo cada', value: '≈ 3 s', mono: true },
                            { label: 'Punto de conexión', value: 'https://rpc.nurachain.net', mono: true },
                            { label: 'Explorador de bloques', value: 'https://explorer.nurachain.net', mono: true },
                            { label: 'Tokens al arrancar', value: 'WNURA, Bridge BNB, Bridge USDT' }
                        ),
                        p('NURA es la moneda propia de la cadena y paga la pequeña comisión de cada transacción. Pero un pool solo puede guardar tokens ERC-20, y NURA no lo es. Así que a NURA se le da un resguardo llamado WNURA: entregas un NURA, recibes un WNURA, y lo cambias de vuelta cuando quieras. La web hace esto dentro de tu operación, así que tú solo ves NURA. Los pools guardan la versión WNURA.'),
                        p('Dos tokens llegan de otras cadenas por un puente: Bridge BNB y Bridge USDT. Cada uno es un derecho sobre la moneda real, guardada bajo llave en su cadena de origen. Importan por dos motivos. Traen valor de fuera. Y como un token dólar vale más o menos un dólar en todas partes, le dan a la cadena su primera regla de medir honesta.')
                    ]
                },
                {
                    id: 'principles',
                    title: 'Las reglas que nos imponemos',
                    blocks: [
                        ul(
                            'Tus monedas siguen siendo tuyas. Nada se mueve hasta que tu cartera lo firma. La web no guarda depósitos, ni claves, ni cuentas.',
                            'Las reglas no se pueden cambiar. Los contratos no tienen botón de actualizar ni interruptor de apagado, ni para nosotros ni para nadie. Lo que hacen hoy lo harán dentro de diez años.',
                            'Matemáticas prestadas, revisadas por miles. El cálculo de precios es el de UniswapV3, copiado número a número en nuestra web y en nuestro servidor, así que la cifra que lees es la que usará el pool.',
                            'Los precios salen del pool, nunca de una suposición. Contar lo que tiene un pool dice muy poco, así que se lo preguntamos al pool directamente, cada vez.',
                            'Tus límites los hace cumplir el contrato, no nosotros. Tú dices el peor precio que aceptas y cuánto tiempo lo das. Si se rompe cualquiera de los dos, la operación sencillamente no ocurre.',
                            'Todo es público. La web, el servidor y las matemáticas son de código abierto, y el archivo con todas las direcciones de los contratos está en el repositorio para quien quiera leerlo.',
                            'Escrito para quien lo usa. Diez idiomas, dos de ellos de derecha a izquierda, con sus propios números. Una página no está terminada hasta que se ha revisado en persa con el mismo cuidado que en inglés.'
                        )
                    ]
                },
                {
                    id: 'concentrated-liquidity',
                    title: 'Cómo decide el precio un pool',
                    blocks: [
                        p('Imagina una olla con dos clases de token dentro, digamos NURA y dólares. Para sacar NURA tienes que meter dólares. Dentro de la olla queda menos NURA, así que la olla pide más por el siguiente. Compra mucho y el precio sube conforme avanzas. Esa es toda la regla: lo que escasea se encarece.'),
                        p('El diseño antiguo repartía el dinero de la olla por todos los precios imaginables, de casi cero a casi infinito. La mayor parte se quedaba en precios a los que nadie va a operar nunca, como llenar una tienda de tallas que nadie usa. Nura Swap te deja elegir un rango de precio y poner tu dinero solo ahí. Dentro de tu rango, tu dinero trabaja mucho más. Fuera, se queda quieto esperando.'),
                        h3('Los precios están en los peldaños de una escalera'),
                        p('Aquí los precios no son una línea continua. Son peldaños de una escalera. Cada peldaño está una centésima de por ciento por encima del anterior, demasiado poco para notarlo, y todo rango empieza y acaba en un peldaño. A los peldaños se les llama ticks. El pool guarda su precio como raíz cuadrada, en forma de número entero, porque los ordenadores suman enteros a la perfección y no pierden decimales por el camino.'),
                        formula('price(i) = 1.0001^i          sqrtPriceX96 = √price × 2^96', 'El peldaño i significa 1,0001 multiplicado por sí mismo i veces. Cada peldaño es un paso del 0,01%, sea el precio diminuto o enorme.'),
                        h3('Lo que de verdad importa es la profundidad'),
                        p('Suma a todos los que tienen el precio actual dentro de su rango y obtienes la profundidad del pool en ese precio. El pool la llama L. La profundidad decide cuánto mueve el precio una operación.'),
                        formula('x · y = L²          Δ√P = Δy / L          Δ(1/√P) = Δx / L', 'Más L, menos movimiento. El pool calcula tu salida exacta a partir de tu entrada y de la profundidad, y salta al peldaño siguiente cuando se pasa del borde del rango de alguien.'),
                        p('Así que el tamaño del pool no es lo que cuenta: importa más dónde está el dinero. Una olla pequeña con todo apretado alrededor del precio aguanta una operación grande sin inmutarse. Una olla mayor con el dinero desparramado, no.'),
                        h3('A dónde va la comisión'),
                        p('Cada operación paga una pequeña comisión. Se reparte entre quienes tenían el precio dentro de su rango en ese momento, en proporción a lo que cada uno puso ahí. Si tu rango no cubría el precio, de esa operación no ganas nada. El pool lleva un total acumulado en vez de pagar a cada uno por separado, y por eso un intercambio cuesta lo mismo tanto si hay diez proveedores como diez mil. Tus comisiones esperan en el pool hasta que vayas a recogerlas.'),
                        table(
                            ['Si tu rango es', 'Tu dinero rinde unas', 'Qué significa'],
                            [
                                ['de ±2% de ancho', '100× más', 'Lo que más gana, pero el precio se le escapa enseguida'],
                                ['de ±10% de ancho', '21× más', 'Una elección habitual para un par que se mueve poco'],
                                ['de ±50% de ancho', '5× más', 'Bastante ancho para aguantar casi cualquier sorpresa'],
                                ['la escalera entera', 'Igual que antes', 'Nunca deja de ganar, nunca gana mucho']
                            ],
                            [0, 1]
                        ),
                        p('La comparación es contra repartir el mismo dinero por toda la escalera, y solo vale mientras el precio siga dentro de tu rango. El intercambio, en una línea: cuanto más estrecho vayas, más ganas y antes te paras.')
                    ]
                },
                {
                    id: 'swap',
                    title: 'Qué pasa cuando intercambias',
                    blocks: [
                        p('Un intercambio es una transacción. La web la prepara y tú la firmas. No hace falta que te fíes de la web para que sea seguro: cada número que importa o se lee de la cadena o lo comprueba el contrato antes de que se muevan tus tokens.'),
                        steps(
                            { title: 'Conecta tu cartera', text: 'Funciona casi cualquier cartera de navegador (MetaMask, Rabby, Trust y otras) y Nura Wallet se conecta por su propio enlace. Conectarte solo permite a la web leer lo que ya tienes. Nada se mueve sin tu firma.' },
                            { title: 'Pide un precio', text: 'Un par puede tener hasta cuatro pools, cada uno con una comisión distinta. La web les pregunta a todos cuánto recibirías y te ofrece la mejor respuesta. La pregunta va a la cadena, no a nosotros, así que el número que ves es el que el pool te dará de verdad.' },
                            { title: 'Pon tus límites', text: 'Eliges el peor precio que aceptas y cuánto tiempo sigue en pie la oferta. La web también te enseña cuánto empuja el precio tu propia operación. Si ese empujón pasa del 15%, se para y te pide que lo confirmes a propósito.' },
                            { title: 'Da permiso', text: 'La primera vez que gastas un token, das permiso por esa cantidad. Por defecto pedimos la cantidad exacta. Puedes dar permiso ilimitado si lo prefieres, y te explicamos claramente qué significa antes de hacerlo.' },
                            { title: 'Envíalo', text: 'Una transacción coge tu token, lo intercambia y te devuelve el otro. Si el resultado fuera peor que tu límite, o se te acabó el tiempo, se cancela todo. Tus tokens no salen de tu cartera y solo pierdes la comisión mínima de red.' }
                        ),
                        h3('Intercambiar NURA'),
                        p('Cuando un lado de tu operación es NURA, la web lo convierte en WNURA a la entrada, o de vuelta a NURA a la salida, dentro de la misma transacción, y te devuelve lo que sobre. Ir de NURA a WNURA no es una operación: es uno por uno, sin comisión y sin pool.'),
                        h3('Si algo sale mal'),
                        p('Cada negativa que puede dar el contrato se convierte en una frase con la que puedes hacer algo. Cancela la firma y no se envió nada. Si el precio pasó tu límite, te lo decimos y te sugerimos operar menos o ampliar el límite. Si se acabó el tiempo, no se gastó nada. Y un token del que no podemos responder aparece etiquetado antes de que puedas operarlo, porque cualquiera puede crear un token y ponerle el nombre que quiera.')
                    ]
                },
                {
                    id: 'liquidity',
                    title: 'Poner tu dinero en un pool',
                    blocks: [
                        p('Cuando aportas a un pool recibes un resguardo, y ese resguardo es a su vez un token tuyo. Registra qué pool, qué rango de precio y cuánto. Solo quien lo tiene puede cambiarlo o cobrar de él, y se puede pasar a otra persona igual que cualquier otro token.'),
                        steps(
                            { title: 'Elige un pool', text: 'Un par puede tener hasta cuatro pools, uno por nivel de comisión. Dos tokens que se mueven juntos encajan en los niveles baratos. Los pares volátiles o poco negociados encajan en 0,30% y 1,00%, donde la comisión más alta te compensa el riesgo más alto.' },
                            { title: 'Elige tu rango de precio', text: 'Escoge el precio más bajo y el más alto que quieras cubrir, o coge la escalera entera. La web ajusta los dos extremos a peldaños reales, te enseña dónde está el precio ahora y te avisa si tu rango queda entero a un lado, porque entonces estás poniendo una orden, no aportando a un mercado.' },
                            { title: 'Mete el dinero', text: 'Si tu rango cubre el precio actual, el pool necesita los dos tokens, en una proporción que decide tu rango. Escribe una cantidad y la web calcula la otra. Apruebas las dos, ves un resumen y una sola transacción lo hace.' },
                            { title: 'Gana y gestiona', text: 'Mientras el precio esté dentro de tu rango cobras una parte de cada operación. Puedes añadir más, retirar una parte o todo, o cobrar lo ganado, cuando quieras. Al sacar tu dinero se cobran también las ganancias.' }
                        ),
                        callout('Quien va primero pone el precio', 'Si el pool todavía no existe, el primer depósito lo crea, y el precio que implica ese depósito pasa a ser el precio del pool. Si te equivocas, los traders te sacarán la diferencia encantados en cuestión de minutos. La web lo dice sin rodeos y te pide que escribas tú mismo el precio de apertura.'),
                        h3('La trampa, en palabras llanas'),
                        p('Aportar a un pool significa que acabas con más del token que todo el mundo está vendiendo. Si el precio se sale de tu rango, te quedas con solo uno de los dos y dejas de ganar hasta que vuelva. Comparado con quedarte los dos tokens sin hacer nada, puedes acabar peor tras un movimiento grande, incluso contando las comisiones que ganaste. Las comisiones son tu pago por asumir eso. Si compensan o no depende del par, de tu rango y de cuánto se opere.')
                    ]
                },
                {
                    id: 'fees',
                    title: 'La comisión y quién se la lleva',
                    blocks: [
                        p('Hay cuatro niveles de comisión, y el nivel es del pool, no del par. Los mismos dos tokens pueden tener un pool en cada nivel, y la web los consulta todos antes de elegir.'),
                        table(
                            ['Comisión', 'En una operación de $1.000', 'Peldaños entre extremos', 'Va bien para'],
                            [
                                ['0,01%', '$0,10', '1', 'Dos tokens que casi no se separan'],
                                ['0,05%', '$0,50', '10', 'Tokens dólar y pares grandes'],
                                ['0,30%', '$3,00', '60', 'La mayoría de los pares'],
                                ['1,00%', '$10,00', '200', 'Tokens nuevos, volátiles o poco negociados']
                            ],
                            [0, 1, 2]
                        ),
                        p('Hoy hasta el último céntimo de esa comisión va a quienes aportan al pool. El diseño de Uniswap permite además una comisión de protocolo: una parte de esa comisión, entre una décima y una cuarta parte, que va a quien sea dueño del contrato factory. Está apagada en todos los pools, y lo que pensamos hacer con ella se explica en la Parte II. Ni la web ni el servidor cobran nada propio encima.')
                    ]
                },
                {
                    id: 'architecture',
                    title: 'Cómo está construido todo esto',
                    blocks: [
                        p('Tres piezas y un archivo pequeño que las une.'),
                        table(
                            ['Pieza', 'Qué hace', 'Dónde vive'],
                            [
                                ['Los contratos', 'Guardan los pools, hacen los intercambios, llevan la cuenta de quién aportó qué', 'En Nura Chain, inmutables'],
                                ['El servidor', 'Vigila los contratos y guarda el historial: precios, gráficos, volumen, operaciones recientes', 'Una máquina pequeña'],
                                ['La web', 'Todo lo que ves y pulsas', 'Tu navegador; la portada y este documento se generan de antemano']
                            ]
                        ),
                        h3('El archivo que lo une todo'),
                        p('Los contratos se desarrollan en un repositorio aparte. Lo único que este proyecto coge de allí es un archivo pequeño con la cadena, las direcciones y los tokens. El servidor lee ese archivo y se lo pasa a tu navegador, así que ninguna dirección está incrustada en la web. Si algún día se vuelve a desplegar el exchange, cambia un archivo y lo demás va detrás.'),
                        h3('Qué le preguntamos a la cadena directamente'),
                        p('Todo aquello de lo que depende tu operación se lee en vivo de la cadena, nunca de nuestro servidor: el precio del pool, la cotización, tus saldos, tus permisos, tus posiciones. Van en un solo paquete para que la página cargue rápido. La web también comprueba qué versión de cada contrato está desplegada de verdad en vez de suponerlo, porque una suposición equivocada construiría en silencio una transacción rota.'),
                        h3('El servidor y por qué existe'),
                        p('Algunas cosas están bien pero ninguna operación depende de ellas: la lista de pools, el gráfico de precios, cuánto se operó ayer, tu propio historial. Eso viene de nuestro servidor. Sigue los contratos según van emitiendo sus eventos, los guarda, y pone precio a cada hora del gráfico con lo que las propias operaciones reportaron. Como aquí un bloque es definitivo al instante, nunca tiene que esperar. Si alguna vez se reinicia la cadena o se vuelve a desplegar el exchange, se da cuenta y empieza de cero. También informa de cuánto se ha retrasado, y la web enseña un aviso cuando eso se nota.'),
                        h3('Precios en dólares'),
                        p('Las cifras en dólares están para ayudarte a leer la página y nunca se usan para ejecutar una operación. El token dólar cuenta como un dólar. Un token puenteado vale lo que valga en su cadena de origen, cosa que ningún pool de aquí puede saber, así que ese precio viene de fuera. Todo lo demás se valora a través del pool más profundo que lo conecte con uno de esos dos, en dos pasadas, para que un token que solo se opera contra NURA también tenga precio. Los totales como el valor bloqueado solo cuentan tokens que se remontan a un ancla real; si no, un pool podría declararse rico con un precio que se ha inventado.'),
                        h3('Qué responde el servidor'),
                        table(
                            ['Pídele', 'Y obtienes'],
                            [
                                ['/api/market/stats', 'Número de pools, valor total bloqueado, volumen de 24 horas y cómo de actualizado está'],
                                ['/api/market/pools', 'Cada pool: sus tokens, reservas, precio, tamaño, volumen y rendimiento por comisiones'],
                                ['/api/market/pools/:address', 'Un pool, más 72 horas de gráfico'],
                                ['/api/market/tokens', 'Cada token con precio en dólares, y si ese precio está anclado'],
                                ['/api/market/txs', 'Operaciones y depósitos recientes, filtrables por cartera'],
                                ['/api/market/deployment', 'El archivo de direcciones descrito arriba'],
                                ['/api/healthz', 'Si el servidor está vivo']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'application',
                    title: 'La web',
                    blocks: [
                        p('La web es la parte que de verdad tocas. Está hecha para comprobarla, no para creérsela: todo es de código abierto y nunca te pide que le confíes nada.'),
                        ul(
                            'Intercambio: precios de todos los niveles de comisión, el efecto de tu propia operación, tus límites, permiso y luego operación, NURA gestionado solo, un gráfico y operaciones recientes.',
                            'Liquidez: los pools de cada nivel con su precio y tamaño; tus posiciones con su rango y si están ganando; añadir, retirar y cobrar, cada cosa con un resumen antes de que pregunte tu cartera.',
                            'Cartera: lo que tienes y cuánto vale, tus posiciones y tu propio historial en la cadena.',
                            'Carteras: cualquier cartera de navegador, reconexión discreta al volver, el enlace de Nura Wallet y un botón para añadir Nura Chain, que nunca te cambia la red a tus espaldas.',
                            'Diez idiomas: inglés, persa, árabe, español, portugués, hindi, chino, ruso, francés y turco. El persa y el árabe se leen de derecha a izquierda, con sus propios números; los importes y las direcciones siempre mantienen su sentido normal.',
                            'Un tema claro y otro oscuro, un contorno nítido en lo que seleccionas con el teclado, y movimiento más suave si tu dispositivo lo pide.',
                            'La portada y este documento se generan de antemano para que abran al instante; las páginas de trading se cargan cuando entras en ellas y corren en tu navegador, donde está tu cartera.'
                        )
                    ]
                },
                {
                    id: 'security',
                    title: 'Seguridad y lo que aun así puede salir mal',
                    blocks: [
                        h3('Qué garantizan los contratos'),
                        ul(
                            'Las matemáticas son las de UniswapV3, sin tocar. No hemos modificado el código del pool, del router ni de las posiciones: está copiado tal cual y fijado a una versión concreta.',
                            'No hay botón de actualizar ni administrador por encima de tu dinero. El dueño del factory puede añadir un nivel de comisión y activar la comisión de protocolo. No puede meter mano en un pool ni en tu posición.',
                            'Tu límite de precio y tu plazo los comprueba el contrato. Aunque esta web fuera sustituida por una copia hostil, esos límites seguirían valiendo.'
                        ),
                        h3('Qué hace la web'),
                        ul(
                            'No hay ninguna clave en ninguna parte del sitio. Cada transacción la firma tu propia cartera, tanto en pruebas como en producción.',
                            'Reglas estrictas sobre qué puede cargar la página, una sola dirección para la web y sus datos, y límites a la frecuencia con que se puede llamar al servidor.',
                            'Los tokens desconocidos se etiquetan antes de que puedas operarlos, un movimiento de precio grande exige una confirmación deliberada, y el permiso ilimitado nunca viene por defecto.',
                            'Todo es de código abierto, con pruebas que contrastan nuestras matemáticas con los contratos originales, nuestro servidor con una cadena simulada y nuestras páginas con un servidor de mentira.'
                        ),
                        callout('Una palabra honesta sobre auditorías', 'El código de Uniswap se ha auditado muchas veces a lo largo de los años. Este despliegue concreto en Nura Chain todavía no lo ha auditado de punta a punta una empresa externa. Esa auditoría está en la hoja de ruta de la Parte II. Hasta que se haga, trata este exchange por lo que es: dinero puesto en común en contratos sobre una cadena joven.'),
                        h3('Riesgos que no desaparecen'),
                        ul(
                            'Un fallo que nadie ha encontrado todavía, en los contratos, en la cadena o en una cartera.',
                            'Riesgo de mercado: la trampa descrita arriba para quien aporta, el movimiento del precio para quien opera, y la poca actividad de un mercado joven.',
                            'Riesgo de puente: un token puenteado vale lo que valga el puente que guarda la moneda real.',
                            'Riesgo de token: cualquiera puede crear un token y llamarlo como quiera. Que exista un pool no dice nada sobre si el token que hay dentro es honesto.',
                            'Averías normales: nuestro servidor o la conexión con la cadena pueden retrasarse o pararse. Se sigue operando, pero los números de la página pueden estar viejos.'
                        )
                    ]
                }
            ]
        },
        {
            id: 'business',
            label: 'Parte II',
            title: 'El plan',
            lede: 'Para quién es esto, cómo se paga solo y qué se construye después.',
            sections: [
                {
                    id: 'vision',
                    title: 'Qué intentamos hacer',
                    blocks: [
                        p('A dónde queremos llegar: que Nura Chain tenga mercado propio, un sitio donde cualquiera, desde cualquier parte, pueda poner precio y operar cualquier token de la cadena, sin nadie en medio.'),
                        p('Cómo llegamos: construir y mantener el exchange en el que se apoya la cadena. Los contratos más fiables, los mejores datos de precios y una web que la gente pueda leer en su idioma, pagado con una comisión pequeña, visible y que hace cumplir el contrato, no nosotros.'),
                        p('Nura Swap es fontanería. Tiene éxito cuando se construyen cosas encima: carteras que cotizan a través de él, tokens nuevos que arrancan en él, aplicaciones que leen de él sus precios.')
                    ]
                },
                {
                    id: 'market',
                    title: 'Para quién es esto',
                    blocks: [
                        p('Nura Chain está en la fase en la que su economía todavía se está formando. La moneda tiene titulares, el puente trae BNB y USDT, y llegarán más tokens según arranquen proyectos. Todos necesitan lo mismo primero: un sitio donde operar. Quien lo ofrezca primero suele quedárselo, porque operar atrae dinero, el dinero atrae operaciones, y los dos juntos atraen todo lo que luego sería un fastidio mover.'),
                        h3('Cuatro tipos de personas'),
                        table(
                            ['Quién', 'Qué necesita', 'Qué encuentra aquí'],
                            [
                                ['Quien tiene NURA', 'Una forma de moverse entre NURA, dólares y monedas puenteadas sin abrir cuenta en ningún sitio', 'Intercambios desde su propia cartera, en su idioma, con límites que hace cumplir el contrato'],
                                ['Quien tiene tokens parados', 'Un rendimiento por tokens que están ahí quietos, sin perder su control', 'Aportar a un pool, elegir el rango y el nivel de comisión, cobrar cuando quiera'],
                                ['Los proyectos nuevos en Nura Chain', 'Mercado para su token desde el primer día, sin pedirle permiso a nadie', 'Cualquiera puede crear un pool en cualquier nivel; se lista y se grafica solo'],
                                ['Carteras y otras aplicaciones', 'Precios e intercambios sobre los que construir', 'Un servicio de datos público, un cotizador y un router en la cadena, y una web que pueden copiar o incrustar']
                            ]
                        ),
                        h3('Por qué aquí y por qué ahora'),
                        ul(
                            'Todavía no hay nadie. No hay un exchange asentado al que desplazar, y la comunidad ya habla los idiomas en los que sale la web.',
                            'El puente es la puerta de entrada. BNB y USDT que llegan a Nura Chain necesitan un sitio donde encontrarse con NURA, y este es ese sitio.',
                            'Nura Wallet trae un conector para este exchange, así que la cartera propia de la cadena trae a sus usuarios directos aquí.'
                        )
                    ]
                },
                {
                    id: 'value',
                    title: 'Cómo se paga solo el proyecto',
                    blocks: [
                        p('Un exchange así crea valor en tres sitios a la vez. Quien tiene tokens parados saca algo de ellos. Quien opera consigue precio sin necesitar a nadie al otro lado. Y toda la cadena consigue una cifra de lo que valen las cosas. Nura Swap se queda una parte de lo primero, con un interruptor que ya viene dentro de los contratos.'),
                        h3('La comisión de protocolo'),
                        p('El diseño de Uniswap permite al dueño del factory activar una comisión de protocolo en un pool: entre una décima y una cuarta parte de la comisión que esa operación ya estaba pagando. Sale de la comisión, no se suma encima, así que quien opera paga exactamente lo mismo en cualquier caso; esa parte simplemente va a otro sitio. Se acumula dentro del pool, en los tokens que se están operando, hasta que se cobra. Hoy está apagada en todos los pools.'),
                        p('El plan es dejarla apagada mientras el exchange todavía esté juntando liquidez, y luego encenderla despacio (los pools más profundos primero, con el ajuste más bajo) cuando quienes aportan ganen bien, y solo después de avisarlo con antelación. Cada cambio es una transacción pública desde una dirección conocida, y cualquiera puede verlo en el explorador.'),
                        h3('A cuánto sale eso'),
                        table(
                            ['Si en un día se opera', 'Los proveedores ganan', 'La parte del proyecto', 'En un año'],
                            [
                                ['$100.000', '$300', '$60', '$21.900'],
                                ['$1.000.000', '$3.000', '$600', '$219.000'],
                                ['$10.000.000', '$30.000', '$6.000', '$2.190.000']
                            ],
                            [0, 1, 2, 3]
                        ),
                        p('Son ejemplos al nivel de comisión del 0,30% con una quinta parte, no previsiones: la cifra real depende de qué pools se lleven la actividad. Lo que importa es la forma. El ingreso crece con la actividad, a quien aporta le cuesta una fracción de lo que gana y a quien opera no le cuesta nada, y para funcionar no hace falta ni token, ni suscripción, ni los depósitos de nadie.'),
                        h3('Otras vías'),
                        ul(
                            'Ayudar a proyectos nuevos a arrancar bien: elegir el nivel de comisión, montar el primer pool, llevar una campaña de recompensas; se cobra por proyecto.',
                            'Ofrecer los datos de precios como servicio a carteras y paneles, mientras el servidor sigue siendo gratis para quien quiera ejecutarlo por su cuenta.',
                            'Subvenciones de Nura Chain para infraestructura que la cadena necesita y este proyecto está bien situado para construir: enrutado, feeds de precios, analítica.'
                        ),
                        callout('No existe ningún token de Nura Swap', 'Este proyecto no tiene token propio y no lo necesita. NURA paga las transacciones, las comisiones llegan en lo que se haya operado, y la comisión de protocolo se cobra igual. No hay venta, ni preventa, ni airdrop previsto. Si eso cambiara alguna vez, se anunciaría en los canales del propio proyecto, nunca por otra persona y nunca en un mensaje privado.')
                    ]
                },
                {
                    id: 'go-to-market',
                    title: 'Cómo lo hacemos crecer',
                    blocks: [
                        steps(
                            { title: 'Lanzamiento: ya hecho', text: 'El exchange en vivo en Nura Chain con WNURA, Bridge BNB y Bridge USDT; el servidor y sus datos; la web en diez idiomas; el conector de Nura Wallet; la versión 1.3.0.' },
                            { title: 'Traer a los primeros proveedores', text: 'Enseñar a la gente, en persa y en inglés, qué es de verdad un rango y cómo leer una posición, y trabajar con Nura Chain en recompensas para los dos pools sobre los que se sostiene el mercado: NURA contra USDT y NURA contra BNB.' },
                            { title: 'Hablar con cada proyecto nuevo', text: 'Hablar con cada equipo que lance un token en Nura Chain antes de que lo lance: el nivel de comisión adecuado, un primer pool, listado y gráfico desde el primer día.' },
                            { title: 'Meternos dentro de todo lo demás', text: 'Poner nuestro cotizador y nuestros datos delante de carteras, exploradores y paneles, para que el precio de este exchange sea el precio de la cadena y su router la forma normal de intercambiar.' },
                            { title: 'Hacernos mayores', text: 'Dar más profundidad a los pools, añadir tokens según crece el puente, activar la comisión de protocolo y gastarla en la hoja de ruta.' }
                        ),
                        h3('Dónde llegamos a la gente'),
                        ul(
                            'Los sitios propios de la cadena: Nura Wallet, el explorador y la comunidad de Nura Chain en Telegram, Discord, X e Instagram.',
                            'La documentación y este documento, en los idiomas que la comunidad lee de verdad.',
                            'Ser de código abierto es en sí un canal: una web que cualquiera puede copiar abarata construir sobre este exchange.'
                        )
                    ]
                },
                {
                    id: 'roadmap',
                    title: 'Qué viene después',
                    blocks: [
                        p('Una dirección, no una promesa. Las cosas avanzan al ritmo de la cadena y de la comunidad. Lo que de verdad ha salido está anotado en el changelog, que es público.'),
                        table(
                            ['Cuándo', 'Qué'],
                            [
                                ['Hecho: 3.er trimestre de 2026', 'El exchange en sí; páginas de intercambio, liquidez y cartera; el servidor de datos; diez idiomas incluidos los de derecha a izquierda; el conector de Nura Wallet; una app instalable'],
                                ['4.º trimestre de 2026', 'Una auditoría externa de este despliegue; operar por dos pools a la vez cuando dé mejor precio; más historial y rendimientos por pool; este documento en más idiomas'],
                                ['Primer semestre de 2027', 'Activar la comisión de protocolo y su política; un programa de recompensas con Nura Chain; rangos usados como órdenes limitadas sencillas; mejores herramientas para gestionar posiciones; más tokens puenteados según los añada el puente'],
                                ['Segundo semestre de 2027', 'Un kit para que carteras y aplicaciones construyan encima; pasar la clave del propietario a una cuenta multifirma con firmantes publicados; ofrecer los precios de los pools como feed en el que puedan apoyarse otras apps de Nura Chain']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'governance',
                    title: 'Quién puede cambiar qué',
                    blocks: [
                        p('Los contratos no se pueden cambiar, así que hay muy poco que gobernar. Una clave, la del dueño del factory, tiene exactamente dos poderes: añadir un nivel de comisión nuevo y activar la comisión de protocolo en un pool. No puede parar un pool, ni coger dinero, ni alterar un nivel de comisión que ya existe, ni tocar la posición de nadie. Los dos poderes se usan en público, en la cadena, donde cualquiera los ve.'),
                        facts(
                            { label: 'La clave del propietario', value: '0x4ac0d9300422b408bA2AbF47995C87cF32763712', mono: true },
                            { label: 'Puede', value: 'Añadir un nivel de comisión; activar la comisión de protocolo en un pool' },
                            { label: 'No puede', value: 'Pausar nada, cambiar el código ni mover un solo token' }
                        ),
                        p('La web y el servidor se publican por el repositorio público con un changelog, y cada versión tiene que pasar las mismas comprobaciones antes de salir. El servidor informa de si está sano y de cómo de actualizado va, así que los problemas se ven pronto. El soporte y los anuncios van por los canales que hay al final de este documento, y por ningún otro sitio.')
                    ]
                },
                {
                    id: 'metrics',
                    title: 'Cómo saber si funciona',
                    blocks: [
                        p('No hace falta que nos creas nada de esto. La portada enseña el dinero de los pools, la actividad del último día y el número de pools, en vivo. Cada cifra de abajo sale de esos mismos datos públicos, y cualquiera puede leerlos.'),
                        table(
                            ['Qué vigilamos', 'Por qué importa'],
                            [
                                ['Dinero en los pools', 'Qué operación tan grande aguanta el mercado sin dar bandazos'],
                                ['Operado en las últimas 24 horas', 'Cuánto movimiento hay, y con qué crecería cualquier comisión futura'],
                                ['Pools y tokens listados', 'Qué parte de la cadena se puede operar de verdad'],
                                ['Proveedores, y cuántos están dentro de rango', 'Si a quienes financian los pools les va bien'],
                                ['Lo que ganaron los proveedores', 'Si aportar a un pool merece la pena'],
                                ['Carteras y apps construidas encima', 'Si el exchange ya forma parte del mobiliario']
                            ]
                        )
                    ]
                },
                {
                    id: 'risks',
                    title: 'Qué puede salir mal con el plan',
                    blocks: [
                        ul(
                            'Crecimiento lento. La economía de una cadena puede tardar más de lo que todos esperaban, y no hay ingresos de operaciones que no ocurren.',
                            'Competencia. Cualquiera puede copiar este código y abrir un rival. La defensa es profundidad, integraciones y confianza, no el secreto, que el código abierto descarta de todas formas.',
                            'El puente. El primer valor de fuera llega por él, así que un problema en el puente es un problema para los tokens valorados a través de él.',
                            'Regulación. Las normas para exchanges así cambian de un país a otro y no paran de moverse. Podemos adaptar cómo opera el proyecto; no podemos adaptar los contratos, porque nadie puede.',
                            'La clave. Hasta que la clave del propietario esté detrás de una cuenta multifirma, quien la robase podría activar la comisión de protocolo. Aun así no podría mover ni un token.',
                            'Seguridad. Un fallo sin descubrir en los contratos, en la cadena o en una cartera podría costarle dinero a la gente. La auditoría de la hoja de ruta reduce ese riesgo. Nada lo elimina.'
                        )
                    ]
                },
                {
                    id: 'contracts',
                    title: 'Anexo A: Las direcciones',
                    blocks: [
                        p('Esto es lo que está vivo en Nura Chain ahora mismo, sacado del archivo descrito antes. Si alguna vez interactúas con alguno directamente, compruébalo primero en el explorador.'),
                        table(
                            ['Qué es', 'Dirección'],
                            [
                                ['Factory: crea los pools', '0x88E8bB62E1654e695043FD5416D5E5415AFFd39b'],
                                ['Router: hace los intercambios', '0x98b52fB699F1F91494b2937fECf109f8E09570Ae'],
                                ['Cotizador: responde «¿cuánto recibiría?»', '0x4b6f7C7d1337F6C6A624677688EA8035c3Ed6782'],
                                ['Gestor de posiciones: tus resguardos', '0xcf00BFaA3c292205D38d37f9086c4F3838339Fbb'],
                                ['Tick lens: lee la escalera', '0xbFdA09e0D89ABa201491F81dcD0993Fd223e66A0'],
                                ['WNURA: NURA como token', '0xf0a4eC07916feBa4432121Ed5969887D9b939cD0'],
                                ['Multicall: muchas preguntas a la vez', '0xf58884FCf45d8F5Cc8A73c618D23EB27b732CA24'],
                                ['Bridge BNB', '0xD4221Ad9772BF5bA7423a044bBBEe6af2154A5Fc'],
                                ['Bridge USDT', '0x4E0DB0B1Da408faF5637202CF48b0bc7733bE6dC'],
                                ['La clave del propietario', '0x4ac0d9300422b408bA2AbF47995C87cF32763712']
                            ],
                            [1]
                        ),
                        facts(
                            { label: 'Id de cadena', value: '1020', mono: true },
                            { label: 'Desplegado en el bloque', value: '124110', mono: true },
                            { label: 'Decimales', value: '18, en todos los tokens listados', mono: true }
                        )
                    ]
                },
                {
                    id: 'glossary',
                    title: 'Anexo B: Palabras usadas en este documento',
                    blocks: [
                        table(
                            ['Palabra', 'Qué significa'],
                            [
                                ['AMM', 'Creador de mercado automático: un contrato que da precio con lo que tiene, en vez de emparejar compradores con vendedores.'],
                                ['Pool', 'Un contrato que guarda dos tokens en un nivel de comisión. Un par puede tener hasta cuatro.'],
                                ['Nivel de comisión', 'Lo que cobra un pool en cada operación: 0,01%, 0,05%, 0,30% o 1,00%.'],
                                ['Tick', 'Un peldaño de la escalera de precios. Cada peldaño está un 0,01% por encima del anterior.'],
                                ['Separación de ticks', 'Cuántos peldaños de distancia deja un nivel de comisión entre los extremos de un rango: 1, 10, 60 o 200.'],
                                ['sqrtPriceX96', 'El precio del pool, guardado como raíz cuadrada y almacenado como entero para que no se redondee nada.'],
                                ['Liquidez (L)', 'Cuánto dinero hay detrás del precio: la profundidad del pool en el peldaño en que está.'],
                                ['Posición', 'Tu resguardo por aportar a un pool: qué pool, qué rango, cuánto.'],
                                ['En rango', 'El precio está entre los dos extremos de tu rango, así que tienes los dos tokens y estás ganando comisiones.'],
                                ['Impacto en el precio', 'Cuánto empuja el precio tu propia operación, antes de la comisión.'],
                                ['Tolerancia al deslizamiento', 'El peor precio que estás dispuesto a aceptar. Pasado eso, el contrato cancela la operación.'],
                                ['Plazo', 'El momento a partir del cual el contrato se niega a ejecutar tu operación.'],
                                ['Cotizador', 'Un contrato que simula un intercambio y dice cuánto recibirías, sin llegar a hacerlo.'],
                                ['Router', 'El contrato que ejecuta los intercambios, envolviendo y desenvolviendo NURA cuando hace falta.'],
                                ['Gestor de posiciones', 'El contrato que emite, cambia y cierra posiciones, y paga sus comisiones.'],
                                ['WNURA', 'NURA en forma de token, canjeable uno por uno, porque los pools solo pueden guardar tokens.'],
                                ['Comisión de protocolo', 'Una parte opcional de la comisión de operación que el dueño del factory puede desviar al proyecto.'],
                                ['Pérdida impermanente', 'Acabar con menos de lo que tendrías si te hubieras quedado tus dos tokens sin hacer nada.'],
                                ['TVL', 'Valor total bloqueado: cuánto vale todo lo que hay en los pools, contando solo precios que podemos anclar.'],
                                ['Indexador', 'Nuestro servidor: sigue los contratos y guarda el historial que enseña la web.']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'links',
                    title: 'Anexo C: Dónde encontrarnos',
                    blocks: [
                        table(
                            ['Qué', 'Dónde'],
                            [
                                ['Código fuente: web, servidor y matemáticas', 'https://github.com/NuraChain/Swap'],
                                ['Punto de conexión de Nura Chain', 'https://rpc.nurachain.net'],
                                ['Explorador de bloques', 'https://explorer.nurachain.net'],
                                ['X', 'https://x.com/nurachainnet'],
                                ['Discord', 'https://discord.gg/8BMAXTdXQg'],
                                ['Telegram', 'https://t.me/nurachain'],
                                ['Instagram', 'https://www.instagram.com/nura.chain/']
                            ],
                            [1]
                        ),
                        ol(
                            'Adams, Zinsmeister, Salem, Keefer, Robinson: Uniswap v3 Core (2021). El artículo del que salen las matemáticas de este exchange.',
                            'El repositorio de Nura Swap: README, CHANGELOG y TESTING, para las partes del sistema descritas aquí.'
                        )
                    ]
                }
            ]
        }
    ]
};
