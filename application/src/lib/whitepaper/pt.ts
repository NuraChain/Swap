// The whitepaper, Portuguese. Section ids and block shapes mirror en.ts exactly -
// tests/whitepaper.spec.ts holds all ten languages to the same outline.
//
// Register: plain, spoken Portuguese. Short sentences, everyday words.

import { callout, facts, formula, h3, ol, p, steps, table, ul } from './model.ts';
import type { Whitepaper } from './model.ts';

export const pt: Whitepaper = {
    meta:
    {
        title: 'Nura Swap',
        subtitle: 'Documento técnico',
        version: 'Documento técnico v1.2',
        date: 'Setembro de 2026',
        covers: 'Descreve a versão 1.3.0 da aplicação na Nura Chain (id de cadeia 1020).',
        abstractTitle: 'Em resumo',
        disclaimerTitle: 'Leia isto, por favor',
        disclaimer: 'Este documento explica como o Nura Swap funciona e o que esperamos construir a seguir. Não é aconselhamento financeiro. Não é uma oferta de venda. Não promete lucro nenhum. Negociar e pôr dinheiro numa pool têm risco real, e pode perder tudo o que puser. Os planos aqui descritos são intenções, não promessas, e podem mudar.'
    },
    abstract: [
        'O Nura Swap é uma máquina de negociação que vive na Nura Chain. Troca um token por outro e ninguém fica no meio. Nenhuma empresa guarda o seu dinheiro. Ninguém o aprova. Não há conta para abrir. As suas moedas ficam na sua própria carteira o tempo todo.',
        'O truque é a pool. Uma pool é um pote partilhado com dois tipos de token lá dentro, e calcula o seu próprio preço a partir do que tem. Quem põe tokens no pote ganha uma pequena comissão de cada troca que passa por ele. É esta a ideia toda. O resto do documento são os detalhes.',
        'O Nura Swap tem três peças: contratos na cadeia que fazem a troca, um servidor pequeno que guarda preços e histórico, e este site, que pode ler em dez idiomas. A Parte I explica como a máquina funciona. A Parte II explica como pensamos pagá-la e fazê-la crescer.'
    ],
    parts: [
        {
            id: 'protocol',
            label: 'Parte I',
            title: 'Como funciona a exchange',
            lede: 'Comece pelo pote de tokens e o resto vem sozinho.',
            sections: [
                {
                    id: 'introduction',
                    title: 'Porque é que uma cadeia precisa de uma máquina de troca',
                    blocks: [
                        p('Uma cadeia nova é como uma vila nova. As moedas existem, mas não há onde as trocar, por isso ninguém sabe quanto valem. Alguém tem de abrir uma loja.'),
                        p('A loja do costume é o livro de ordens: uma lista comprida de gente que quer comprar e gente que quer vender. Só funciona se estiver alguém do outro lado da sua troca no momento em que a quer fazer. E normalmente é preciso uma empresa que segure o dinheiro de toda a gente enquanto a lista é cruzada. Numa cadeia jovem raramente está alguém do outro lado. E entregar as suas moedas a uma empresa é exatamente aquilo que uma blockchain veio evitar.'),
                        p('O Nura Swap faz ao contrário. Em vez de juntar duas pessoas, mantém um pote com dois tipos de token lá dentro. Você negoceia com o pote. Mete um token, tira o outro, e o pote calcula o preço sozinho. Está sempre aberto, nunca diz que não, e não guarda nada seu durante mais tempo do que a sua troca demora.'),
                        p('A matemática dentro do pote não é nossa. O Nura Swap corre o UniswapV3 exatamente como está escrito: o código mais usado e mais verificado do género. O que construímos é tudo o que está à volta dele para esta cadeia: a instalação, os dados de preços, o site em dez idiomas e o plano da Parte II.')
                    ]
                },
                {
                    id: 'nura-chain',
                    title: 'A Nura Chain numa página',
                    blocks: [
                        p('A Nura Chain é a rede onde tudo isto corre. Escreve um bloco novo mais ou menos de três em três segundos, e assim que está escrito está feito: não se espera para ver se pega. Por isso a sua troca termina no momento em que o bloco dela aparece. A cadeia fala a mesma língua que a Ethereum, por isso carteiras e ferramentas feitas para a Ethereum funcionam aqui sem mudar nada.'),
                        facts(
                            { label: 'Id de cadeia', value: '1020', mono: true },
                            { label: 'A moeda dela', value: 'NURA (18 casas decimais)', mono: true },
                            { label: 'Versão embrulhada', value: 'WNURA, sempre 1:1', mono: true },
                            { label: 'Como se acordam os blocos', value: 'CometBFT: um bloco escrito é definitivo' },
                            { label: 'Um bloco novo a cada', value: '≈ 3 s', mono: true },
                            { label: 'Ponto de ligação', value: 'https://rpc.nurachain.net', mono: true },
                            { label: 'Explorador de blocos', value: 'https://explorer.nurachain.net', mono: true },
                            { label: 'Tokens no arranque', value: 'WNURA, Bridge BNB, Bridge USDT' }
                        ),
                        p('O NURA é a moeda da própria cadeia e paga a pequena taxa de cada transação. Mas uma pool só consegue segurar tokens ERC-20, e o NURA não é um. Por isso o NURA recebe um talão chamado WNURA: entrega um NURA, recebe um WNURA, e troca de volta quando quiser. O site faz isto dentro da sua troca, por isso você só vê NURA. As pools guardam a versão WNURA.'),
                        p('Dois tokens chegam de outras cadeias por uma ponte: Bridge BNB e Bridge USDT. Cada um é um direito sobre a moeda verdadeira, fechada à chave na cadeia de origem. Interessam por duas razões. Trazem valor de fora. E como um token dólar vale mais ou menos um dólar em qualquer sítio, dão à cadeia a sua primeira régua honesta.')
                    ]
                },
                {
                    id: 'principles',
                    title: 'As regras que impomos a nós próprios',
                    blocks: [
                        ul(
                            'As suas moedas continuam suas. Nada se mexe até a sua carteira assinar. O site não guarda depósitos, nem chaves, nem contas.',
                            'As regras não se podem mudar. Os contratos não têm botão de atualizar nem interruptor de desligar: nem para nós, nem para ninguém. O que fazem hoje farão daqui a dez anos.',
                            'Matemática emprestada, verificada por milhares. O cálculo de preços é o do UniswapV3, copiado número a número para o nosso site e para o nosso servidor, por isso o valor que lê é o valor que a pool vai usar.',
                            'Os preços vêm da pool, nunca de um palpite. Contar o que uma pool tem diz muito pouco, por isso perguntamos à pool diretamente, sempre.',
                            'Os seus limites são impostos pelo contrato, não por nós. Você diz o pior preço que aceita e quanto tempo dá. Se algum deles for quebrado, a troca simplesmente não acontece.',
                            'Tudo é público. O site, o servidor e a matemática são de código aberto, e o ficheiro com todos os endereços dos contratos está no repositório para quem quiser ler.',
                            'Escrito para quem o usa. Dez idiomas, dois deles da direita para a esquerda, com os seus próprios algarismos. Uma página não está pronta enquanto não for revista em persa com o mesmo cuidado que em inglês.'
                        )
                    ]
                },
                {
                    id: 'concentrated-liquidity',
                    title: 'Como é que uma pool decide o preço',
                    blocks: [
                        p('Imagine um pote com dois tipos de token lá dentro, digamos NURA e dólares. Para tirar NURA tem de meter dólares. Fica menos NURA dentro do pote, por isso o pote passa a pedir mais pelo seguinte. Compre muito e o preço sobe à medida que avança. É esta a regra toda: o que escasseia fica mais caro.'),
                        p('O desenho antigo espalhava o dinheiro do pote por todos os preços imagináveis, de quase zero a quase infinito. A maior parte ficava em preços onde ninguém vai negociar nunca, como encher uma loja de tamanhos que ninguém veste. O Nura Swap deixa-o escolher um intervalo de preço e pôr o seu dinheiro só ali. Dentro do seu intervalo, o dinheiro trabalha muito mais. Fora, fica parado à espera.'),
                        h3('Os preços estão em degraus de uma escada'),
                        p('Aqui os preços não são uma linha lisa. São degraus de uma escada. Cada degrau está um centésimo de por cento acima do anterior, pequeno de mais para se notar, e todos os intervalos começam e acabam num degrau. Aos degraus chama-se ticks. A pool guarda o preço como raiz quadrada, na forma de número inteiro, porque os computadores somam inteiros na perfeição e não perdem frações pelo caminho.'),
                        formula('price(i) = 1.0001^i          sqrtPriceX96 = √price × 2^96', 'O degrau i significa 1,0001 multiplicado por si próprio i vezes. Cada degrau é um passo de 0,01%, seja o preço minúsculo ou enorme.'),
                        h3('O que interessa mesmo é a profundidade'),
                        p('Some toda a gente cujo intervalo cobre o preço neste momento e obtém a profundidade da pool nesse preço. A pool chama-lhe L. A profundidade decide quanto é que uma troca mexe o preço.'),
                        formula('x · y = L²          Δ√P = Δy / L          Δ(1/√P) = Δx / L', 'Mais L, menos movimento. A pool calcula a sua saída exata a partir da entrada e da profundidade, e passa ao degrau seguinte quando ultrapassa a ponta do intervalo de alguém.'),
                        p('Ou seja, o tamanho da pool não é o que conta: onde está o dinheiro interessa mais. Um pote pequeno com tudo encostado ao preço aguenta uma troca grande sem estremecer. Um pote maior com o dinheiro espalhado, não.'),
                        h3('Para onde vai a comissão'),
                        p('Cada troca paga uma pequena comissão. É repartida por quem tinha o preço dentro do seu intervalo naquele momento, na proporção do que cada um lá pôs. Se o seu intervalo não cobria o preço, dessa troca não ganha nada. A pool guarda um total acumulado em vez de pagar a cada um à vez, e é por isso que uma troca custa o mesmo quer haja dez fornecedores quer dez mil. As suas comissões esperam na pool até você as ir buscar.'),
                        table(
                            ['Se o seu intervalo for', 'O seu dinheiro rende cerca de', 'O que isso quer dizer'],
                            [
                                ['de ±2% de largura', '100× mais', 'É o que mais ganha, mas o preço foge-lhe depressa'],
                                ['de ±10% de largura', '21× mais', 'Escolha comum para um par que se mexe devagar'],
                                ['de ±50% de largura', '5× mais', 'Largo que chegue para aguentar quase todas as surpresas'],
                                ['a escada inteira', 'Tal como antes', 'Nunca deixa de ganhar, nunca ganha muito']
                            ],
                            [0, 1]
                        ),
                        p('A comparação é com espalhar o mesmo dinheiro pela escada toda, e só vale enquanto o preço se mantiver dentro do seu intervalo. A troca, numa linha: quanto mais estreito for, mais ganha e mais cedo para.')
                    ]
                },
                {
                    id: 'swap',
                    title: 'O que acontece quando troca',
                    blocks: [
                        p('Uma troca é uma transação. O site prepara-a e você assina-a. Não precisa de confiar no site para ser seguro: cada número que interessa ou é lido da cadeia ou é verificado pelo contrato antes de os seus tokens se mexerem.'),
                        steps(
                            { title: 'Ligue a sua carteira', text: 'Funciona quase qualquer carteira de navegador (MetaMask, Rabby, Trust e outras) e a Nura Wallet liga-se pelo seu próprio link. Ligar-se só permite ao site ler o que já tem. Nada se mexe sem a sua assinatura.' },
                            { title: 'Peça um preço', text: 'Um par pode ter até quatro pools, cada uma com uma comissão diferente. O site pergunta a todas quanto receberia e oferece-lhe a melhor resposta. A pergunta vai à cadeia, não a nós, por isso o número que vê é o que a pool lhe vai dar mesmo.' },
                            { title: 'Defina os seus limites', text: 'Escolhe o pior preço que aceita e quanto tempo a oferta se mantém. O site mostra-lhe também quanto é que a sua própria troca empurra o preço. Se esse empurrão passar dos 15%, para e pede-lhe que confirme de propósito.' },
                            { title: 'Dê autorização', text: 'Na primeira vez que gasta um token, autoriza aquele valor. Por omissão pedimos o valor exato. Pode dar autorização ilimitada se preferir, e dizemos-lhe claramente o que isso significa antes de o fazer.' },
                            { title: 'Envie', text: 'Uma transação pega no seu token, troca-o e devolve-lhe o outro. Se o resultado ficasse pior do que o seu limite, ou se o tempo acabasse, cancela-se tudo. Os seus tokens não saem da carteira e só perde a taxa mínima de rede.' }
                        ),
                        h3('Trocar o próprio NURA'),
                        p('Quando um dos lados da sua troca é NURA, o site transforma-o em WNURA à entrada, ou de volta em NURA à saída, dentro da mesma transação, e devolve o que sobrar. Passar de NURA a WNURA não é uma troca: é um por um, sem comissão e sem pool.'),
                        h3('Se alguma coisa correr mal'),
                        p('Cada recusa que o contrato pode dar é traduzida numa frase com a qual pode fazer alguma coisa. Cancele a assinatura e nada foi enviado. Se o preço passou o seu limite, dizemos-lhe e sugerimos negociar menos ou alargar o limite. Se o tempo acabou, não se gastou nada. E um token pelo qual não podemos responder aparece marcado antes de o poder negociar, porque qualquer pessoa pode criar um token e dar-lhe o nome que quiser.')
                    ]
                },
                {
                    id: 'liquidity',
                    title: 'Pôr o seu dinheiro numa pool',
                    blocks: [
                        p('Quando fornece uma pool recebe um talão, e esse talão é ele próprio um token seu. Regista qual a pool, qual o intervalo de preço e quanto. Só quem o tem pode alterá-lo ou levantar dele, e pode ser passado a outra pessoa como qualquer outro token.'),
                        steps(
                            { title: 'Escolha uma pool', text: 'Um par pode ter até quatro pools, uma por nível de comissão. Dois tokens que andam juntos dão-se bem com os níveis baratos. Pares voláteis ou pouco negociados dão-se bem com 0,30% e 1,00%, onde a comissão maior o compensa pelo risco maior.' },
                            { title: 'Escolha o seu intervalo de preço', text: 'Escolha o preço mais baixo e o mais alto que quer cobrir, ou fique com a escada toda. O site encaixa as duas pontas em degraus reais, mostra onde está o preço agora e avisa-o se o seu intervalo ficar todo de um lado, porque aí está mesmo a colocar uma ordem e não a fornecer um mercado.' },
                            { title: 'Meta o dinheiro', text: 'Se o seu intervalo cobrir o preço atual, a pool precisa dos dois tokens, numa proporção que o seu intervalo decide. Escreva um valor e o site calcula o outro. Aprova os dois, vê um resumo, e uma só transação trata de tudo.' },
                            { title: 'Ganhe e faça a gestão', text: 'Enquanto o preço estiver dentro do seu intervalo recebe uma parte de cada troca. Pode acrescentar mais, tirar uma parte ou tudo, ou levantar o que ganhou, quando quiser. Levantar o dinheiro leva também os ganhos.' }
                        ),
                        callout('Quem vai primeiro define o preço', 'Se a pool ainda não existir, o primeiro depósito cria-a, e o preço que esse depósito implica passa a ser o preço da pool. Engane-se e os traders tiram-lhe a diferença do bolso com todo o gosto em minutos. O site diz isto sem rodeios e pede-lhe que escreva você mesmo o preço de abertura.'),
                        h3('A armadilha, em palavras simples'),
                        p('Fornecer uma pool significa que acaba com mais do token que toda a gente está a vender. Se o preço sair do seu intervalo, fica só com um dos dois e deixa de ganhar até ele voltar. Comparado com simplesmente ficar com os dois tokens sem fazer nada, pode acabar pior depois de um movimento grande, mesmo contando as comissões que ganhou. As comissões são o seu pagamento por assumir isso. Se chegam ou não depende do par, do seu intervalo e de quanto se negoceia.')
                    ]
                },
                {
                    id: 'fees',
                    title: 'A comissão e quem fica com ela',
                    blocks: [
                        p('Há quatro níveis de comissão, e o nível pertence à pool e não ao par. Os mesmos dois tokens podem ter uma pool em cada nível, e o site consulta-as todas antes de escolher.'),
                        table(
                            ['Comissão', 'Numa troca de $1.000', 'Degraus entre pontas', 'Serve para'],
                            [
                                ['0,01%', '$0,10', '1', 'Dois tokens que quase não se afastam'],
                                ['0,05%', '$0,50', '10', 'Tokens dólar e pares grandes'],
                                ['0,30%', '$3,00', '60', 'A maioria dos pares'],
                                ['1,00%', '$10,00', '200', 'Tokens novos, voláteis ou pouco negociados']
                            ],
                            [0, 1, 2]
                        ),
                        p('Hoje até ao último cêntimo dessa comissão vai para quem fornece a pool. O desenho da Uniswap permite ainda uma comissão de protocolo: uma fatia dessa comissão, entre um décimo e um quarto, que vai para quem for dono do contrato factory. Está desligada em todas as pools, e o que pensamos fazer com ela está na Parte II. Nem o site nem o servidor cobram nada de seu por cima.')
                    ]
                },
                {
                    id: 'architecture',
                    title: 'Como está construído isto tudo',
                    blocks: [
                        p('Três peças e um ficheiro pequeno que as liga.'),
                        table(
                            ['Peça', 'O que faz', 'Onde vive'],
                            [
                                ['Os contratos', 'Guardam as pools, fazem as trocas, registam quem forneceu o quê', 'Na Nura Chain, imutáveis'],
                                ['O servidor', 'Vigia os contratos e guarda o histórico: preços, gráficos, volume, trocas recentes', 'Uma máquina pequena'],
                                ['O site', 'Tudo o que vê e onde clica', 'O seu navegador; a página inicial e este documento são gerados de antemão']
                            ]
                        ),
                        h3('O ficheiro que liga tudo'),
                        p('Os contratos são desenvolvidos num repositório à parte. A única coisa que este projeto tira de lá é um ficheiro pequeno com a cadeia, os endereços e os tokens. O servidor lê esse ficheiro e passa-o ao seu navegador, por isso não há nenhum endereço enterrado no site. Se um dia a exchange for reinstalada, muda um ficheiro e o resto vai atrás.'),
                        h3('O que perguntamos diretamente à cadeia'),
                        p('Tudo aquilo de que a sua troca depende é lido em direto da cadeia, nunca do nosso servidor: o preço da pool, a cotação, os seus saldos, as suas autorizações, as suas posições. Vão num só pacote para a página carregar depressa. O site também verifica que versão de cada contrato está mesmo instalada em vez de a assumir, porque uma suposição errada construiria em silêncio uma transação estragada.'),
                        h3('O servidor e para que serve'),
                        p('Há coisas que são boas de ter mas de que nenhuma troca depende: a lista de pools, o gráfico de preços, quanto se negociou ontem, o seu próprio histórico. Isso vem do nosso servidor. Ele segue os contratos à medida que emitem os eventos, guarda-os, e dá preço a cada hora do gráfico com o que as próprias trocas comunicaram. Como aqui um bloco é definitivo logo, nunca tem de esperar. Se a cadeia for reiniciada ou a exchange reinstalada, dá por isso e recomeça do princípio. Também informa do atraso que leva, e o site mostra um aviso quando isso se nota.'),
                        h3('Preços em dólares'),
                        p('Os valores em dólares existem para o ajudar a ler a página e nunca são usados para executar uma troca. O token dólar conta como um dólar. Um token de ponte vale o que valer na cadeia de origem, coisa que nenhuma pool daqui pode saber, por isso esse preço vem de fora. Todo o resto é avaliado através da pool mais funda que o liga a um desses dois, em duas passagens, para que um token que só é negociado contra NURA também tenha preço. Totais como o valor bloqueado só contam tokens que se ligam a uma âncora real; senão, uma pool podia declarar-se rica com um preço que inventou.'),
                        h3('A que responde o servidor'),
                        table(
                            ['Peça-lhe', 'E recebe'],
                            [
                                ['/api/market/stats', 'Número de pools, valor total bloqueado, volume de 24 horas e quão atualizado está'],
                                ['/api/market/pools', 'Cada pool: os seus tokens, reservas, preço, tamanho, volume e retorno de comissões'],
                                ['/api/market/pools/:address', 'Uma pool, mais 72 horas de gráfico'],
                                ['/api/market/tokens', 'Cada token com preço em dólares, e se esse preço está ancorado'],
                                ['/api/market/txs', 'Trocas e depósitos recentes, filtráveis por carteira'],
                                ['/api/market/deployment', 'O ficheiro de endereços descrito acima'],
                                ['/api/healthz', 'Se o servidor está vivo']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'application',
                    title: 'O site',
                    blocks: [
                        p('O site é a parte em que mexe mesmo. Está feito para ser verificado e não para ser acreditado: é todo de código aberto e nunca lhe pede que lhe confie o que quer que seja.'),
                        ul(
                            'Troca: preços de todos os níveis de comissão, o efeito da sua própria troca, os seus limites, autorização e depois troca, NURA tratado sozinho, um gráfico e trocas recentes.',
                            'Liquidez: as pools de cada nível com preço e tamanho; as suas posições com o intervalo e se estão a ganhar; acrescentar, retirar e levantar, cada coisa com um resumo antes de a carteira perguntar.',
                            'Carteira: o que tem e quanto vale, as suas posições e o seu próprio histórico na cadeia.',
                            'Carteiras: qualquer carteira de navegador, religação discreta quando volta, o link da Nura Wallet, e um botão para acrescentar a Nura Chain, que nunca lhe muda a rede pelas costas.',
                            'Dez idiomas: inglês, persa, árabe, espanhol, português, hindi, chinês, russo, francês e turco. O persa e o árabe leem-se da direita para a esquerda, com os seus algarismos; valores e endereços mantêm sempre o sentido normal.',
                            'Um tema claro e outro escuro, um contorno nítido no que selecionar com o teclado, e movimento mais calmo se o seu aparelho pedir.',
                            'A página inicial e este documento são gerados de antemão para abrirem logo; as páginas de negociação carregam quando lá entra e correm no seu navegador, onde está a sua carteira.'
                        )
                    ]
                },
                {
                    id: 'security',
                    title: 'Segurança e o que ainda assim pode correr mal',
                    blocks: [
                        h3('O que os contratos garantem'),
                        ul(
                            'A matemática é a do UniswapV3, sem alterações. Não tocámos no código da pool, do router nem das posições: está copiado tal e qual e fixado numa versão certa.',
                            'Não há botão de atualizar nem administrador por cima do seu dinheiro. O dono do factory pode acrescentar um nível de comissão e ligar a comissão de protocolo. Não consegue meter a mão numa pool nem na sua posição.',
                            'O seu limite de preço e o seu prazo são verificados pelo contrato. Mesmo que este site fosse substituído por uma cópia hostil, esses limites continuariam de pé.'
                        ),
                        h3('O que o site faz'),
                        ul(
                            'Não há nenhuma chave em lado nenhum do site. Cada transação é assinada pela sua própria carteira, tanto em testes como em produção.',
                            'Regras estritas sobre o que a página pode carregar, um só endereço para o site e os seus dados, e limites à frequência com que o servidor pode ser chamado.',
                            'Tokens desconhecidos são marcados antes de os poder negociar, um movimento de preço grande exige uma confirmação deliberada, e autorização ilimitada nunca é a opção por omissão.',
                            'Tudo é de código aberto, com testes que comparam a nossa matemática com os contratos originais, o nosso servidor com uma cadeia simulada e as nossas páginas com um servidor de faz de conta.'
                        ),
                        callout('Uma palavra honesta sobre auditorias', 'O código da Uniswap foi auditado muitas vezes ao longo dos anos. Esta instalação em particular na Nura Chain ainda não foi auditada de ponta a ponta por uma empresa de fora. Essa auditoria está no roteiro da Parte II. Até estar feita, trate esta exchange pelo que é: dinheiro reunido em contratos numa cadeia jovem.'),
                        h3('Riscos que não desaparecem'),
                        ul(
                            'Uma falha que ainda ninguém encontrou, nos contratos, na cadeia ou numa carteira.',
                            'Risco de mercado: a armadilha descrita acima para quem fornece, o movimento do preço para quem negoceia, e a pouca atividade de um mercado jovem.',
                            'Risco de ponte: um token de ponte vale o que valer a ponte que guarda a moeda verdadeira.',
                            'Risco de token: qualquer pessoa pode criar um token e chamar-lhe o que quiser. Existir uma pool não diz nada sobre se o token lá dentro é honesto.',
                            'Avarias normais: o nosso servidor ou a ligação à cadeia podem atrasar-se ou parar. Continua a negociar-se, mas os números da página podem estar velhos.'
                        )
                    ]
                }
            ]
        },
        {
            id: 'business',
            label: 'Parte II',
            title: 'O plano',
            lede: 'Para quem é isto, como se paga a si próprio e o que se constrói a seguir.',
            sections: [
                {
                    id: 'vision',
                    title: 'O que estamos a tentar fazer',
                    blocks: [
                        p('Onde queremos chegar: que a Nura Chain tenha mercado próprio, um sítio onde qualquer pessoa, de qualquer lado, possa avaliar e negociar qualquer token da cadeia, sem ninguém pelo meio.'),
                        p('Como lá chegamos: construir e manter a exchange em que a cadeia se apoia. Os contratos mais fiáveis, os melhores dados de preços e um site que as pessoas leiam na sua língua, pago por uma comissão pequena, visível e imposta pelo contrato e não por nós.'),
                        p('O Nura Swap é canalização. Tem sucesso quando se constroem coisas por cima: carteiras que cotam através dele, tokens novos que arrancam nele, aplicações que lhe leem os preços.')
                    ]
                },
                {
                    id: 'market',
                    title: 'Para quem é isto',
                    blocks: [
                        p('A Nura Chain está na fase em que a economia ainda se está a formar. A moeda tem detentores, a ponte traz BNB e USDT, e chegarão mais tokens à medida que os projetos arrancarem. Todos precisam primeiro da mesma coisa: um sítio onde negociar. Quem o der primeiro tende a ficar com ele, porque negociar atrai dinheiro, o dinheiro atrai negociação, e os dois juntos atraem tudo o que depois seria uma chatice mudar.'),
                        h3('Quatro tipos de pessoas'),
                        table(
                            ['Quem', 'Do que precisa', 'O que encontra aqui'],
                            [
                                ['Quem tem NURA', 'Uma forma de andar entre NURA, dólares e moedas de ponte sem abrir conta em lado nenhum', 'Trocas a partir da própria carteira, na sua língua, com limites impostos pelo contrato'],
                                ['Quem tem tokens parados', 'Um retorno por tokens que estão ali sem fazer nada, sem perder o controlo deles', 'Fornecer uma pool, escolher o intervalo e o nível de comissão, levantar ganhos quando quiser'],
                                ['Projetos novos na Nura Chain', 'Mercado para o seu token logo no primeiro dia, sem pedir licença a ninguém', 'Qualquer pessoa pode criar uma pool em qualquer nível; fica listada e com gráfico automaticamente'],
                                ['Carteiras e outras aplicações', 'Preços e trocas sobre os quais construir', 'Um serviço de dados público, um cotador e um router na cadeia, e um site que podem copiar ou embeber']
                            ]
                        ),
                        h3('Porquê aqui e porquê agora'),
                        ul(
                            'Ainda não está aqui ninguém. Não há uma exchange instalada para desalojar, e a comunidade já fala as línguas em que o site sai.',
                            'A ponte é a porta de entrada. BNB e USDT que chegam à Nura Chain precisam de um sítio para se encontrarem com o NURA, e é este.',
                            'A Nura Wallet traz um conector para esta exchange, por isso a carteira da própria cadeia traz os utilizadores diretamente para aqui.'
                        )
                    ]
                },
                {
                    id: 'value',
                    title: 'Como é que o projeto se paga',
                    blocks: [
                        p('Uma exchange assim cria valor em três sítios ao mesmo tempo. Quem tem tokens parados tira alguma coisa deles. Quem negoceia consegue preço sem precisar de alguém do outro lado. E a cadeia inteira ganha um número para quanto valem as coisas. O Nura Swap fica com uma parte do primeiro, através de um interruptor que já vem dentro dos contratos.'),
                        h3('A comissão de protocolo'),
                        p('O desenho da Uniswap deixa o dono do factory ligar uma comissão de protocolo numa pool: entre um décimo e um quarto da comissão que a troca já estava a pagar. Sai de dentro da comissão e não por cima, por isso quem negoceia paga exatamente o mesmo de qualquer forma; a fatia é que vai para outro lado. Vai-se juntando dentro da pool, nos tokens que estão a ser negociados, até ser levantada. Hoje está desligada em todas as pools.'),
                        p('O plano é deixá-la desligada enquanto a exchange ainda está a juntar liquidez, e depois ligá-la devagar (pools mais fundas primeiro, no valor mais baixo) quando quem fornece já ganhar como deve ser, e só depois de o dizermos com antecedência. Cada mudança é uma transação pública a partir de um endereço conhecido, e qualquer pessoa a pode ver no explorador.'),
                        h3('Quanto é que isso dá'),
                        table(
                            ['Se num dia se negociar', 'Os fornecedores ganham', 'A parte do projeto', 'Num ano'],
                            [
                                ['$100.000', '$300', '$60', '$21.900'],
                                ['$1.000.000', '$3.000', '$600', '$219.000'],
                                ['$10.000.000', '$30.000', '$6.000', '$2.190.000']
                            ],
                            [0, 1, 2, 3]
                        ),
                        p('São exemplos no nível de 0,30% com uma fatia de um quinto, não previsões: o número real depende de que pools levam a negociação. O que interessa é a forma. A receita cresce com a negociação, custa a quem fornece uma fração do que ganha e a quem negoceia não custa nada, e para funcionar não precisa de token, nem de subscrição, nem dos depósitos de ninguém.'),
                        h3('Outras entradas'),
                        ul(
                            'Ajudar projetos novos a arrancar como deve ser: escolher o nível de comissão, montar a primeira pool, correr uma campanha de recompensas; cobrado por projeto.',
                            'Fornecer os dados de preços como serviço a carteiras e painéis, enquanto o servidor em si continua livre para quem o quiser correr sozinho.',
                            'Bolsas da Nura Chain para infraestrutura de que a cadeia precisa e que este projeto está bem posicionado para construir: encaminhamento, feeds de preços, análise.'
                        ),
                        callout('Não existe nenhum token Nura Swap', 'Este projeto não tem token próprio e não precisa de um. O NURA paga as transações, as comissões chegam naquilo que foi negociado, e a comissão de protocolo é cobrada da mesma maneira. Não há venda, nem pré-venda, nem airdrop previsto. Se isso alguma vez mudar, será anunciado nos canais do próprio projeto, nunca por outra pessoa e nunca numa mensagem privada.')
                    ]
                },
                {
                    id: 'go-to-market',
                    title: 'Como o fazemos crescer',
                    blocks: [
                        steps(
                            { title: 'Lançamento: já feito', text: 'A exchange no ar na Nura Chain com WNURA, Bridge BNB e Bridge USDT; o servidor e os seus dados; o site em dez idiomas; o conector da Nura Wallet; a versão 1.3.0.' },
                            { title: 'Trazer os primeiros fornecedores', text: 'Ensinar às pessoas, em persa e em inglês, o que é mesmo um intervalo e como se lê uma posição, e trabalhar com a Nura Chain em recompensas para as duas pools onde o mercado assenta: NURA contra USDT e NURA contra BNB.' },
                            { title: 'Falar com cada projeto novo', text: 'Falar com cada equipa que lance um token na Nura Chain antes do lançamento: o nível de comissão certo, uma primeira pool, listagem e gráfico logo no primeiro dia.' },
                            { title: 'Ficar dentro de tudo o resto', text: 'Pôr o nosso cotador e os nossos dados à frente de carteiras, exploradores e painéis, para que o preço desta exchange passe a ser o preço da cadeia e o seu router a forma normal de trocar.' },
                            { title: 'Crescer', text: 'Dar mais profundidade às pools, acrescentar tokens à medida que a ponte cresce, ligar a comissão de protocolo e gastá-la no roteiro.' }
                        ),
                        h3('Onde chegamos às pessoas'),
                        ul(
                            'Os sítios da própria cadeia: a Nura Wallet, o explorador e a comunidade Nura Chain no Telegram, Discord, X e Instagram.',
                            'A documentação e este documento, nas línguas que a comunidade lê mesmo.',
                            'Ser de código aberto é por si um canal: um site que qualquer pessoa pode copiar torna barato construir sobre esta exchange.'
                        )
                    ]
                },
                {
                    id: 'roadmap',
                    title: 'O que vem a seguir',
                    blocks: [
                        p('Uma direção, não uma promessa. As coisas andam ao ritmo da cadeia e da comunidade. O que saiu mesmo está registado no changelog, que é público.'),
                        table(
                            ['Quando', 'O quê'],
                            [
                                ['Feito: 3.º trimestre de 2026', 'A exchange em si; páginas de troca, liquidez e carteira; o servidor de dados; dez idiomas incluindo os da direita para a esquerda; o conector da Nura Wallet; uma app instalável'],
                                ['4.º trimestre de 2026', 'Uma auditoria externa desta instalação; negociar por duas pools ao mesmo tempo quando isso der melhor preço; mais histórico e retornos por pool; este documento em mais idiomas'],
                                ['1.º semestre de 2027', 'Ligar a comissão de protocolo e a política para o fazer; um programa de recompensas com a Nura Chain; intervalos usados como ordens limitadas simples; melhores ferramentas para gerir posições; mais tokens de ponte à medida que a ponte os acrescenta'],
                                ['2.º semestre de 2027', 'Um kit para carteiras e aplicações construírem por cima; passar a chave do dono para uma conta multiassinatura com signatários publicados; oferecer os preços das pools como feed em que outras apps da Nura Chain se possam apoiar']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'governance',
                    title: 'Quem pode mudar o quê',
                    blocks: [
                        p('Os contratos não se podem mudar, por isso há muito pouco para governar. Uma chave, a do dono do factory, tem exatamente dois poderes: acrescentar um nível de comissão novo e ligar a comissão de protocolo numa pool. Não pode parar uma pool, nem tirar dinheiro, nem alterar um nível de comissão que já existe, nem tocar na posição de ninguém. Os dois poderes são usados em público, na cadeia, onde toda a gente os vê.'),
                        facts(
                            { label: 'A chave do dono', value: '0x4ac0d9300422b408bA2AbF47995C87cF32763712', mono: true },
                            { label: 'Pode', value: 'Acrescentar um nível de comissão; ligar a comissão de protocolo numa pool' },
                            { label: 'Não pode', value: 'Parar seja o que for, mudar o código ou mexer num único token' }
                        ),
                        p('O site e o servidor saem pelo repositório público com um changelog, e cada versão tem de passar as mesmas verificações antes de ir para o ar. O servidor informa se está saudável e quão atualizado vai, por isso os problemas aparecem depressa. O apoio e os anúncios passam pelos canais listados no fim deste documento, e por mais nenhum.')
                    ]
                },
                {
                    id: 'metrics',
                    title: 'Como saber se está a resultar',
                    blocks: [
                        p('Não precisa de acreditar em nada disto só porque o dizemos. A página inicial mostra o dinheiro nas pools, a negociação do último dia e o número de pools, em direto. Cada número abaixo vem desses mesmos dados públicos, e qualquer pessoa os pode ler.'),
                        table(
                            ['O que vigiamos', 'Porque interessa'],
                            [
                                ['Dinheiro nas pools', 'Que troca tão grande é que o mercado aguenta sem abanar'],
                                ['Negociação nas últimas 24 horas', 'Quanto movimento há, e com o que cresceria qualquer comissão futura'],
                                ['Pools e tokens listados', 'Que parte da cadeia é mesmo negociável'],
                                ['Fornecedores, e quantos estão dentro do intervalo', 'Se quem financia as pools está a ir bem'],
                                ['O que os fornecedores ganharam', 'Se fornecer uma pool vale a pena'],
                                ['Carteiras e apps construídas por cima', 'Se a exchange já faz parte da mobília']
                            ]
                        )
                    ]
                },
                {
                    id: 'risks',
                    title: 'O que pode correr mal com o plano',
                    blocks: [
                        ul(
                            'Crescimento lento. A economia de uma cadeia pode demorar mais do que toda a gente esperava, e não há receita de negociação que não acontece.',
                            'Concorrência. Qualquer pessoa pode copiar este código e abrir um rival. A defesa é profundidade, integrações e confiança, não segredo, que o código aberto exclui de qualquer forma.',
                            'A ponte. O primeiro valor de fora chega por ela, por isso problemas na ponte são problemas para os tokens avaliados através dela.',
                            'Regulação. As regras para exchanges destas variam de país para país e não param de mudar. Podemos adaptar a forma como o projeto opera; não podemos adaptar os contratos, porque ninguém pode.',
                            'A chave. Enquanto a chave do dono não estiver atrás de uma conta multiassinatura, quem a roubasse podia ligar a comissão de protocolo. Mesmo assim não conseguiria mexer num único token.',
                            'Segurança. Uma falha por descobrir nos contratos, na cadeia ou numa carteira pode custar dinheiro às pessoas. A auditoria do roteiro reduz esse risco. Nada o elimina.'
                        )
                    ]
                },
                {
                    id: 'contracts',
                    title: 'Anexo A: Os endereços',
                    blocks: [
                        p('Isto é o que está no ar na Nura Chain neste momento, tirado do ficheiro descrito atrás. Se alguma vez interagir com um deles diretamente, confirme-o primeiro no explorador.'),
                        table(
                            ['O que é', 'Endereço'],
                            [
                                ['Factory: cria as pools', '0x88E8bB62E1654e695043FD5416D5E5415AFFd39b'],
                                ['Router: faz as trocas', '0x98b52fB699F1F91494b2937fECf109f8E09570Ae'],
                                ['Cotador: responde «quanto receberia?»', '0x4b6f7C7d1337F6C6A624677688EA8035c3Ed6782'],
                                ['Gestor de posições: os seus talões', '0xcf00BFaA3c292205D38d37f9086c4F3838339Fbb'],
                                ['Tick lens: lê a escada', '0xbFdA09e0D89ABa201491F81dcD0993Fd223e66A0'],
                                ['WNURA: NURA como token', '0xf0a4eC07916feBa4432121Ed5969887D9b939cD0'],
                                ['Multicall: muitas perguntas de uma vez', '0xf58884FCf45d8F5Cc8A73c618D23EB27b732CA24'],
                                ['Bridge BNB', '0xD4221Ad9772BF5bA7423a044bBBEe6af2154A5Fc'],
                                ['Bridge USDT', '0x4E0DB0B1Da408faF5637202CF48b0bc7733bE6dC'],
                                ['A chave do dono', '0x4ac0d9300422b408bA2AbF47995C87cF32763712']
                            ],
                            [1]
                        ),
                        facts(
                            { label: 'Id de cadeia', value: '1020', mono: true },
                            { label: 'Instalado no bloco', value: '124110', mono: true },
                            { label: 'Casas decimais', value: '18, em todos os tokens listados', mono: true }
                        )
                    ]
                },
                {
                    id: 'glossary',
                    title: 'Anexo B: Palavras usadas neste documento',
                    blocks: [
                        table(
                            ['Palavra', 'O que quer dizer'],
                            [
                                ['AMM', 'Criador de mercado automático: um contrato que dá preço a partir do que tem, em vez de juntar compradores a vendedores.'],
                                ['Pool', 'Um contrato que guarda dois tokens num nível de comissão. Um par pode ter até quatro.'],
                                ['Nível de comissão', 'O que uma pool cobra em cada troca: 0,01%, 0,05%, 0,30% ou 1,00%.'],
                                ['Tick', 'Um degrau da escada de preços. Cada degrau está 0,01% acima do anterior.'],
                                ['Espaçamento de ticks', 'Quantos degraus de distância um nível de comissão deixa entre as pontas de um intervalo: 1, 10, 60 ou 200.'],
                                ['sqrtPriceX96', 'O preço da pool, guardado como raiz quadrada e armazenado como inteiro para nada ser arredondado.'],
                                ['Liquidez (L)', 'Quanto dinheiro está por trás do preço: a profundidade da pool no degrau em que está.'],
                                ['Posição', 'O seu talão por fornecer uma pool: que pool, que intervalo, quanto.'],
                                ['Dentro do intervalo', 'O preço está entre as duas pontas do seu intervalo, por isso tem os dois tokens e está a ganhar comissões.'],
                                ['Impacto no preço', 'Quanto é que a sua própria troca empurra o preço, antes da comissão.'],
                                ['Tolerância a deslize', 'O pior preço que está disposto a aceitar. Depois disso, o contrato cancela a troca.'],
                                ['Prazo', 'O momento a partir do qual o contrato se recusa a executar a sua troca.'],
                                ['Cotador', 'Um contrato que finge fazer uma troca e diz quanto receberia, sem a fazer.'],
                                ['Router', 'O contrato que executa as trocas, embrulhando e desembrulhando NURA quando é preciso.'],
                                ['Gestor de posições', 'O contrato que emite, altera e fecha posições, e paga as comissões delas.'],
                                ['WNURA', 'NURA em forma de token, trocável um por um, porque as pools só conseguem guardar tokens.'],
                                ['Comissão de protocolo', 'Uma fatia opcional da comissão de negociação que o dono do factory pode desviar para o projeto.'],
                                ['Perda impermanente', 'Acabar com menos do que se tivesse simplesmente ficado com os seus dois tokens sem fazer nada.'],
                                ['TVL', 'Valor total bloqueado: quanto vale tudo o que está nas pools, contando só preços que conseguimos ancorar.'],
                                ['Indexador', 'O nosso servidor: segue os contratos e guarda o histórico que o site mostra.']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'links',
                    title: 'Anexo C: Onde nos encontrar',
                    blocks: [
                        table(
                            ['O quê', 'Onde'],
                            [
                                ['Código-fonte: site, servidor e matemática', 'https://github.com/NuraChain/Swap'],
                                ['Ponto de ligação da Nura Chain', 'https://rpc.nurachain.net'],
                                ['Explorador de blocos', 'https://explorer.nurachain.net'],
                                ['X', 'https://x.com/nurachainnet'],
                                ['Discord', 'https://discord.gg/8BMAXTdXQg'],
                                ['Telegram', 'https://t.me/nurachain'],
                                ['Instagram', 'https://www.instagram.com/nura.chain/']
                            ],
                            [1]
                        ),
                        ol(
                            'Adams, Zinsmeister, Salem, Keefer, Robinson: Uniswap v3 Core (2021). O artigo de onde vem a matemática desta exchange.',
                            'O repositório do Nura Swap: README, CHANGELOG e TESTING, para as partes do sistema descritas aqui.'
                        )
                    ]
                }
            ]
        }
    ]
};
