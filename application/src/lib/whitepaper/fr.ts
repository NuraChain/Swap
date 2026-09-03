// The whitepaper, French. Section ids and block shapes mirror en.ts exactly -
// tests/whitepaper.spec.ts holds all ten languages to the same outline.
//
// Register: plain, spoken French. Short sentences, everyday words.

import { callout, facts, formula, h3, ol, p, steps, table, ul } from './model.ts';
import type { Whitepaper } from './model.ts';

export const fr: Whitepaper = {
    meta:
    {
        title: 'Nura Swap',
        subtitle: 'Livre blanc',
        version: 'Livre blanc v1.2',
        date: 'Septembre 2026',
        covers: 'Décrit la version 1.3.0 de l’application sur Nura Chain (id de chaîne 1020).',
        abstractTitle: 'En bref',
        disclaimerTitle: 'À lire, s’il vous plaît',
        disclaimer: 'Ce document explique comment Nura Swap fonctionne et ce que nous espérons construire ensuite. Ce n’est pas un conseil financier. Ce n’est pas une offre de vente. Il ne promet aucun gain. Échanger et placer de l’argent dans un pool comportent un vrai risque, et vous pouvez perdre tout ce que vous y mettez. Les plans décrits ici sont des intentions, pas des promesses, et ils peuvent changer.'
    },
    abstract: [
        'Nura Swap est une machine à échanger qui vit sur Nura Chain. Elle troque un jeton contre un autre, et personne ne se met au milieu. Aucune société ne détient votre argent. Personne ne vous approuve. Il n’y a pas de compte à ouvrir. Vos pièces restent dans votre propre portefeuille tout du long.',
        'L’astuce, c’est le pool. Un pool est un pot commun qui contient deux sortes de jetons, et il calcule son prix tout seul à partir de ce qu’il a. Celui qui met des jetons dans le pot gagne une petite commission sur chaque échange qui passe par lui. Voilà toute l’idée. Le reste du document, ce sont les détails.',
        'Nura Swap est fait de trois morceaux : des contrats sur la chaîne qui font l’échange, un petit serveur qui garde les prix et l’historique, et ce site, que vous pouvez lire en dix langues. La partie I explique comment la machine marche. La partie II explique comment nous comptons la financer et la faire grandir.'
    ],
    parts: [
        {
            id: 'protocol',
            label: 'Partie I',
            title: 'Comment fonctionne la plateforme',
            lede: 'Commencez par le pot de jetons, le reste suit tout seul.',
            sections: [
                {
                    id: 'introduction',
                    title: 'Pourquoi une chaîne a besoin d’une machine à échanger',
                    blocks: [
                        p('Une chaîne neuve, c’est comme une ville neuve. Les pièces existent, mais il n’y a nulle part où les échanger, donc personne ne sait ce qu’elles valent. Il faut bien que quelqu’un ouvre une boutique.'),
                        p('La boutique à l’ancienne, c’est le carnet d’ordres : une longue liste de gens qui veulent acheter et de gens qui veulent vendre. Ça ne marche que si quelqu’un se tient de l’autre côté de votre échange pile au moment où vous le voulez. Et il faut d’habitude une société pour garder l’argent de tout le monde pendant que la liste s’apparie. Sur une chaîne jeune, il n’y a presque jamais personne en face. Et confier ses pièces à une société, c’est exactement ce qu’une blockchain vient éviter.'),
                        p('Nura Swap fait l’inverse. Au lieu d’apparier deux personnes, il garde un pot avec deux sortes de jetons dedans. Vous échangez avec le pot. Vous mettez un jeton, vous prenez l’autre, et le pot calcule le prix tout seul. Il est toujours ouvert, il ne dit jamais non, et il ne garde rien qui soit à vous plus longtemps que les quelques secondes de votre échange.'),
                        p('Les maths à l’intérieur du pot ne sont pas les nôtres. Nura Swap fait tourner UniswapV3 exactement tel quel : le code le plus utilisé et le plus vérifié du genre. Ce que nous avons construit, c’est tout ce qu’il y a autour pour cette chaîne : l’installation, les données de prix, le site en dix langues et le plan de la partie II.')
                    ]
                },
                {
                    id: 'nura-chain',
                    title: 'Nura Chain en une page',
                    blocks: [
                        p('Nura Chain, c’est le réseau sur lequel tout ceci tourne. Un nouveau bloc est écrit à peu près toutes les trois secondes, et une fois écrit c’est fini : pas besoin d’attendre pour voir s’il tient. Votre échange est donc terminé au moment où son bloc apparaît. La chaîne parle la même langue qu’Ethereum, donc les portefeuilles et les outils faits pour Ethereum marchent ici sans rien changer.'),
                        facts(
                            { label: 'Id de chaîne', value: '1020', mono: true },
                            { label: 'Sa pièce', value: 'NURA (18 décimales)', mono: true },
                            { label: 'Version emballée', value: 'WNURA, toujours 1:1', mono: true },
                            { label: 'Comment les blocs sont validés', value: 'CometBFT : un bloc écrit est définitif' },
                            { label: 'Un nouveau bloc toutes les', value: '≈ 3 s', mono: true },
                            { label: 'Point de connexion', value: 'https://rpc.nurachain.net', mono: true },
                            { label: 'Explorateur de blocs', value: 'https://explorer.nurachain.net', mono: true },
                            { label: 'Jetons au lancement', value: 'WNURA, Bridge BNB, Bridge USDT' }
                        ),
                        p('NURA est la pièce de la chaîne elle-même, et c’est elle qui paie la petite commission de chaque transaction. Mais un pool ne peut détenir que des jetons ERC-20, et NURA n’en est pas un. On donne donc à NURA un ticket appelé WNURA : vous remettez un NURA, vous recevez un WNURA, et vous le rendez quand vous voulez. Le site fait ça à l’intérieur de votre échange, donc vous ne voyez que NURA. Les pools détiennent la version WNURA.'),
                        p('Deux jetons arrivent d’autres chaînes par un pont : Bridge BNB et Bridge USDT. Chacun est un droit sur la vraie pièce, enfermée sur sa chaîne d’origine. Ils comptent pour deux raisons. Ils font entrer de la valeur de l’extérieur. Et comme un jeton dollar vaut à peu près un dollar partout, ils donnent à la chaîne son premier étalon honnête.')
                    ]
                },
                {
                    id: 'principles',
                    title: 'Les règles que nous nous imposons',
                    blocks: [
                        ul(
                            'Vos pièces restent les vôtres. Rien ne bouge tant que votre portefeuille n’a pas signé. Le site ne garde ni dépôts, ni clés, ni comptes.',
                            'Les règles ne peuvent pas changer. Les contrats n’ont ni bouton de mise à jour ni interrupteur d’arrêt : ni pour nous, ni pour personne. Ce qu’ils font aujourd’hui, ils le feront dans dix ans.',
                            'Des maths empruntées, vérifiées par des milliers de gens. Le calcul des prix est celui d’UniswapV3, recopié chiffre par chiffre dans notre site et notre serveur, donc le nombre que vous lisez est celui que le pool utilisera.',
                            'Les prix viennent du pool lui-même, jamais d’une supposition. Compter ce qu’un pool détient ne dit pas grand-chose, alors nous demandons au pool directement, à chaque fois.',
                            'Vos limites sont appliquées par le contrat, pas par nous. Vous dites le pire prix que vous acceptez et le temps que vous laissez. Si l’un des deux est dépassé, l’échange n’a tout simplement pas lieu.',
                            'Tout est public. Le site, le serveur et les maths sont en open source, et le fichier qui liste toutes les adresses des contrats est dans le dépôt, à lire par qui veut.',
                            'Écrit pour ceux qui s’en servent. Dix langues, dont deux de droite à gauche, avec leurs propres chiffres. Une page n’est pas finie tant qu’elle n’a pas été relue en persan avec autant de soin qu’en anglais.'
                        )
                    ]
                },
                {
                    id: 'concentrated-liquidity',
                    title: 'Comment un pool décide du prix',
                    blocks: [
                        p('Imaginez un pot avec deux sortes de jetons dedans, disons des NURA et des dollars. Pour sortir des NURA, il faut mettre des dollars. Il reste moins de NURA dans le pot, donc le pot demande plus cher pour le suivant. Achetez beaucoup et le prix monte au fur et à mesure. Toute la règle est là : ce qui manque devient plus cher.'),
                        p('L’ancien modèle étalait l’argent du pot sur tous les prix imaginables, de presque zéro à presque l’infini. La plus grande partie restait à des prix où personne n’échangera jamais, comme remplir une boutique de tailles que personne ne porte. Nura Swap vous laisse choisir une plage de prix et n’y mettre votre argent que là. Dans votre plage, votre argent travaille bien plus. En dehors, il reste immobile et attend.'),
                        h3('Les prix tiennent sur les barreaux d’une échelle'),
                        p('Ici, les prix ne forment pas une ligne lisse. Ce sont des barreaux d’échelle. Chaque barreau est un centième de pour cent au-dessus du précédent, bien trop peu pour se remarquer, et toute plage commence et finit sur un barreau. On appelle ces barreaux des ticks. Le pool garde son prix sous forme de racine carrée, stockée en nombre entier, parce que les ordinateurs additionnent les entiers parfaitement et ne perdent jamais de décimale en route.'),
                        formula('price(i) = 1.0001^i          sqrtPriceX96 = √price × 2^96', 'Le barreau i, c’est 1,0001 multiplié par lui-même i fois. Chaque barreau est un pas de 0,01 %, que le prix soit minuscule ou énorme.'),
                        h3('Ce qui compte vraiment, c’est la profondeur'),
                        p('Additionnez tous ceux dont la plage couvre le prix actuel : vous obtenez la profondeur du pool à ce prix. Le pool l’appelle L. La profondeur décide de combien un échange déplace le prix.'),
                        formula('x · y = L²          Δ√P = Δy / L          Δ(1/√P) = Δx / L', 'Plus L est grand, moins ça bouge. Le pool calcule votre sortie exacte à partir de votre entrée et de la profondeur, puis passe au barreau suivant quand il dépasse le bord de la plage de quelqu’un.'),
                        p('Donc la taille d’un pool n’est pas ce qui compte : où se trouve l’argent compte davantage. Un petit pot dont tout est serré autour du prix encaisse un gros échange sans broncher. Un pot plus gros avec l’argent éparpillé partout, non.'),
                        h3('Où va la commission'),
                        p('Chaque échange paie une petite commission. Elle est partagée entre ceux dont la plage couvrait le prix à cet instant, au prorata de ce que chacun y avait mis. Si votre plage ne couvrait pas le prix, vous ne gagnez rien sur cet échange. Le pool tient un total courant au lieu de payer les gens un par un, et c’est pour ça qu’un échange coûte pareil qu’il y ait dix fournisseurs ou dix mille. Vos commissions attendent dans le pool jusqu’à ce que vous veniez les prendre.'),
                        table(
                            ['Si votre plage fait', 'Votre argent travaille environ', 'Ce que ça veut dire'],
                            [
                                ['±2 % de large', '100× plus', 'C’est ce qui rapporte le plus, mais le prix s’en échappe vite'],
                                ['±10 % de large', '21× plus', 'Un choix courant pour une paire qui bouge lentement'],
                                ['±50 % de large', '5× plus', 'Assez large pour encaisser la plupart des surprises'],
                                ['toute l’échelle', 'Autant qu’avant', 'Ne cesse jamais de gagner, ne gagne jamais beaucoup']
                            ],
                            [0, 1]
                        ),
                        p('La comparaison se fait avec le même argent étalé sur toute l’échelle, et elle ne vaut que tant que le prix reste dans votre plage. Le compromis en une ligne : plus vous serrez, plus vous gagnez et plus vite vous vous arrêtez.')
                    ]
                },
                {
                    id: 'swap',
                    title: 'Ce qui se passe quand vous échangez',
                    blocks: [
                        p('Un échange, c’est une transaction. Le site la prépare, vous la signez. Vous n’avez pas besoin de faire confiance au site pour que ce soit sûr : chaque nombre qui compte est soit lu sur la chaîne, soit vérifié par le contrat avant que vos jetons ne bougent.'),
                        steps(
                            { title: 'Connectez votre portefeuille', text: 'Presque tous les portefeuilles de navigateur marchent (MetaMask, Rabby, Trust et d’autres) et Nura Wallet se connecte par son propre lien. Se connecter permet seulement au site de lire ce que vous avez déjà. Rien ne bouge sans votre signature.' },
                            { title: 'Demandez un prix', text: 'Une paire peut avoir jusqu’à quatre pools, chacun avec une commission différente. Le site demande à chacun d’eux ce que vous recevriez et vous propose la meilleure réponse. La question part vers la chaîne, pas vers nous, donc le nombre affiché est bien celui que le pool vous donnera.' },
                            { title: 'Posez vos limites', text: 'Vous choisissez le pire prix que vous acceptez et combien de temps l’offre tient. Le site vous montre aussi de combien votre propre échange pousse le prix. Si cette poussée dépasse 15 %, il s’arrête et vous demande de confirmer exprès.' },
                            { title: 'Donnez l’autorisation', text: 'La première fois que vous dépensez un jeton, vous autorisez ce montant. Par défaut, nous demandons le montant exact. Vous pouvez donner une autorisation illimitée si vous préférez, et nous vous disons clairement ce que ça veut dire avant.' },
                            { title: 'Envoyez', text: 'Une transaction prend votre jeton, l’échange et vous rend l’autre. Si le résultat était pire que votre limite, ou si le temps est écoulé, tout est annulé. Vos jetons ne quittent jamais votre portefeuille et vous ne perdez que la minuscule commission de réseau.' }
                        ),
                        h3('Échanger NURA lui-même'),
                        p('Quand un côté de votre échange est du NURA, le site le transforme en WNURA à l’entrée, ou le retransforme en NURA à la sortie, dans la même transaction, et vous rend le reliquat. Passer de NURA à WNURA n’est pas un échange : c’est un pour un, sans commission et sans pool.'),
                        h3('Si quelque chose se passe mal'),
                        p('Chaque refus que le contrat peut renvoyer est traduit en une phrase sur laquelle vous pouvez agir. Annulez la signature et rien n’a été envoyé. Si le prix a dépassé votre limite, nous vous le disons et suggérons d’échanger moins ou d’élargir la limite. Si le temps est écoulé, rien n’a été dépensé. Et un jeton dont nous ne pouvons pas répondre est signalé avant que vous puissiez l’échanger, parce que n’importe qui peut créer un jeton et lui donner le nom qu’il veut.')
                    ]
                },
                {
                    id: 'liquidity',
                    title: 'Mettre votre argent dans un pool',
                    blocks: [
                        p('Quand vous alimentez un pool, vous recevez un reçu, et ce reçu est lui-même un jeton qui vous appartient. Il note quel pool, quelle plage de prix et combien. Seul celui qui le détient peut le modifier ou encaisser dessus, et il se transmet à quelqu’un d’autre exactement comme n’importe quel jeton.'),
                        steps(
                            { title: 'Choisissez un pool', text: 'Une paire peut avoir jusqu’à quatre pools, un par niveau de commission. Deux jetons qui restent collés conviennent aux niveaux bon marché. Les paires agitées ou peu échangées conviennent à 0,30 % et 1,00 %, où la commission plus élevée vous paie pour le risque plus élevé.' },
                            { title: 'Choisissez votre plage de prix', text: 'Choisissez le prix le plus bas et le plus haut que vous voulez couvrir, ou prenez toute l’échelle. Le site cale les deux bouts sur de vrais barreaux, montre où est le prix maintenant, et vous prévient si votre plage tombe entièrement d’un côté, parce que là vous passez en réalité un ordre, vous n’alimentez pas un marché.' },
                            { title: 'Mettez l’argent', text: 'Si votre plage couvre le prix actuel, le pool a besoin des deux jetons, dans une proportion que votre plage décide. Tapez un montant et le site calcule l’autre. Vous approuvez les deux, vous voyez un récapitulatif, et une seule transaction fait le travail.' },
                            { title: 'Gagnez et gérez', text: 'Tant que le prix est dans votre plage, vous touchez une part de chaque échange. Vous pouvez ajouter, retirer une partie ou tout, ou encaisser ce que vous avez gagné, quand vous voulez. Retirer votre argent encaisse aussi les gains.' }
                        ),
                        callout('Le premier arrivé fixe le prix', 'Si le pool n’existe pas encore, le premier dépôt le crée, et le prix qu’implique ce dépôt devient le prix du pool. Trompez-vous et les traders vous prendront la différence avec plaisir en quelques minutes. Le site le dit sans détour et vous demande de taper vous-même le prix d’ouverture.'),
                        h3('Le piège, en mots simples'),
                        p('Alimenter un pool veut dire que vous finissez avec davantage du jeton que tout le monde est en train de vendre. Si le prix sort de votre plage, il ne vous reste qu’un des deux, et vous cessez de gagner tant qu’il ne revient pas. Comparé à garder simplement les deux jetons sans rien faire, vous pouvez finir perdant après un gros mouvement, même en comptant les commissions gagnées. Les commissions sont votre paiement pour accepter ça. Qu’elles suffisent ou non dépend de la paire, de votre plage, et du volume d’échanges.')
                    ]
                },
                {
                    id: 'fees',
                    title: 'La commission, et qui la touche',
                    blocks: [
                        p('Il y a quatre niveaux de commission, et le niveau appartient au pool, pas à la paire. Les deux mêmes jetons peuvent avoir un pool à chaque niveau, et le site les interroge tous avant de choisir.'),
                        table(
                            ['Commission', 'Sur un échange de 1 000 $', 'Barreaux entre les bouts', 'Convient à'],
                            [
                                ['0,01 %', '0,10 $', '1', 'Deux jetons qui ne s’écartent presque pas'],
                                ['0,05 %', '0,50 $', '10', 'Jetons dollar et grosses paires'],
                                ['0,30 %', '3,00 $', '60', 'La plupart des paires'],
                                ['1,00 %', '10,00 $', '200', 'Jetons neufs, agités ou peu échangés']
                            ],
                            [0, 1, 2]
                        ),
                        p('Aujourd’hui, chaque centime de cette commission va à ceux qui alimentent le pool. Le modèle d’Uniswap permet aussi une commission de protocole : une part de cette commission, entre un dixième et un quart, versée au propriétaire du contrat factory. Elle est éteinte sur tous les pools, et ce que nous comptons en faire est expliqué dans la partie II. Ni le site ni le serveur ne prennent quoi que ce soit en plus.')
                    ]
                },
                {
                    id: 'architecture',
                    title: 'Comment tout ça est construit',
                    blocks: [
                        p('Trois morceaux, et un petit fichier qui les relie.'),
                        table(
                            ['Morceau', 'Ce qu’il fait', 'Où il vit'],
                            [
                                ['Les contrats', 'Détiennent les pools, font les échanges, tiennent le compte de qui a fourni quoi', 'Sur Nura Chain, immuables'],
                                ['Le serveur', 'Surveille les contrats et garde l’historique : prix, graphiques, volume, échanges récents', 'Une petite machine'],
                                ['Le site', 'Tout ce que vous voyez et cliquez', 'Votre navigateur ; la page d’accueil et ce document sont générés à l’avance']
                            ]
                        ),
                        h3('Le fichier qui relie tout'),
                        p('Les contrats sont développés dans un dépôt séparé. La seule chose que ce projet en prend, c’est un petit fichier qui liste la chaîne, les adresses et les jetons. Le serveur lit ce fichier et le passe à votre navigateur, donc aucune adresse n’est enfouie dans le site. Si la plateforme est un jour redéployée, un fichier change et tout le reste suit.'),
                        h3('Ce que nous demandons directement à la chaîne'),
                        p('Tout ce dont votre échange dépend est lu en direct sur la chaîne, jamais sur notre serveur : le prix du pool, la cotation, vos soldes, vos autorisations, vos positions. Tout part en un seul paquet pour que la page charge vite. Le site vérifie aussi quelle version de chaque contrat est réellement déployée au lieu de le supposer, parce qu’une mauvaise supposition fabriquerait en silence une transaction cassée.'),
                        h3('Le serveur, et pourquoi il existe'),
                        p('Certaines choses sont agréables mais aucun échange n’en dépend : la liste des pools, le graphique de prix, le volume d’hier, votre propre historique. Ça vient de notre serveur. Il suit les contrats au fur et à mesure qu’ils émettent leurs événements, les enregistre, et valorise chaque heure du graphique à partir de ce que les échanges eux-mêmes ont rapporté. Comme un bloc de cette chaîne est définitif tout de suite, il n’attend jamais. Si la chaîne est réinitialisée ou la plateforme redéployée, il s’en aperçoit et repart de zéro. Il indique aussi son retard, et le site affiche un bandeau quand ce retard devient visible.'),
                        h3('Les prix en dollars'),
                        p('Les montants en dollars sont là pour vous aider à lire la page, et ne servent jamais à exécuter un échange. Le jeton dollar compte pour un dollar. Un jeton ponté vaut ce qu’il vaut sur sa chaîne d’origine, ce qu’aucun pool d’ici ne peut savoir, donc ce prix vient de l’extérieur. Tout le reste est valorisé par le pool le plus profond qui le relie à l’un de ces deux-là, en deux passes, pour qu’un jeton échangé seulement contre NURA ait quand même un prix. Les totaux comme la valeur bloquée ne comptent que les jetons qui remontent à une vraie ancre, sinon un pool pourrait se déclarer riche avec un prix qu’il a inventé.'),
                        h3('Ce à quoi le serveur répond'),
                        table(
                            ['Demandez-lui', 'Vous obtenez'],
                            [
                                ['/api/market/stats', 'Nombre de pools, valeur totale bloquée, volume sur 24 heures, et à quel point c’est à jour'],
                                ['/api/market/pools', 'Chaque pool : ses jetons, ses réserves, son prix, sa taille, son volume et son rendement de commissions'],
                                ['/api/market/pools/:address', 'Un pool, plus 72 heures de graphique'],
                                ['/api/market/tokens', 'Chaque jeton avec un prix en dollars, et si ce prix est ancré'],
                                ['/api/market/txs', 'Échanges et dépôts récents, filtrables par portefeuille'],
                                ['/api/market/deployment', 'Le fichier d’adresses décrit plus haut'],
                                ['/api/healthz', 'Si le serveur est vivant']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'application',
                    title: 'Le site',
                    blocks: [
                        p('Le site, c’est la partie que vous touchez vraiment. Il est fait pour être vérifié plutôt que cru : tout est en open source, et il ne vous demande jamais de lui confier quoi que ce soit.'),
                        ul(
                            'Échange : prix de tous les niveaux de commission, effet de votre propre échange, vos limites, autorisation puis échange, NURA géré tout seul, un graphique et les échanges récents.',
                            'Liquidité : les pools de chaque niveau avec leur prix et leur taille ; vos positions avec leur plage et si elles gagnent ; ajouter, retirer et encaisser, chaque fois avec un récapitulatif avant que votre portefeuille ne demande.',
                            'Portefeuille : ce que vous détenez et ce que ça vaut, vos positions, et votre propre historique sur la chaîne.',
                            'Portefeuilles : tous les portefeuilles de navigateur, reconnexion discrète quand vous revenez, le lien Nura Wallet, et un bouton pour ajouter Nura Chain, qui ne change jamais votre réseau dans votre dos.',
                            'Dix langues : anglais, persan, arabe, espagnol, portugais, hindi, chinois, russe, français et turc. Le persan et l’arabe se lisent de droite à gauche, avec leurs propres chiffres ; montants et adresses gardent toujours leur sens normal.',
                            'Un thème clair et un thème sombre, un contour net sur ce que vous sélectionnez au clavier, et des animations plus calmes si votre appareil le demande.',
                            'La page d’accueil et ce document sont générés à l’avance pour s’ouvrir instantanément ; les pages de trading se chargent quand vous y allez et tournent dans votre navigateur, là où est votre portefeuille.'
                        )
                    ]
                },
                {
                    id: 'security',
                    title: 'La sécurité, et ce qui peut quand même mal tourner',
                    blocks: [
                        h3('Ce que les contrats garantissent'),
                        ul(
                            'Les maths sont celles d’UniswapV3, inchangées. Nous n’avons touché ni au code du pool, ni au routeur, ni aux positions : c’est recopié tel quel et figé sur une version précise.',
                            'Il n’y a ni bouton de mise à jour ni administrateur au-dessus de votre argent. Le propriétaire du factory peut ajouter un niveau de commission et activer la commission de protocole. Il ne peut pas mettre la main dans un pool ni dans votre position.',
                            'Votre limite de prix et votre délai sont vérifiés par le contrat. Même si ce site était remplacé par une copie hostile, ces limites tiendraient toujours.'
                        ),
                        h3('Ce que fait le site'),
                        ul(
                            'Il n’y a aucune clé nulle part dans le site. Chaque transaction est signée par votre propre portefeuille, en test comme en production.',
                            'Des règles strictes sur ce que la page peut charger, une seule adresse pour le site et ses données, et des limites sur la fréquence d’appel du serveur.',
                            'Les jetons inconnus sont signalés avant que vous puissiez les échanger, un gros mouvement de prix exige une confirmation délibérée, et l’autorisation illimitée n’est jamais le réglage par défaut.',
                            'Tout est en open source, avec des tests qui confrontent nos maths aux contrats d’origine, notre serveur à une chaîne scriptée, et nos pages à un serveur factice.'
                        ),
                        callout('Un mot honnête sur les audits', 'Le code d’Uniswap a été audité de nombreuses fois au fil des ans. Ce déploiement précis sur Nura Chain n’a pas encore été audité de bout en bout par une société extérieure. Cet audit figure dans la feuille de route de la partie II. En attendant, traitez cette plateforme pour ce qu’elle est : de l’argent mis en commun dans des contrats sur une chaîne jeune.'),
                        h3('Des risques qui ne disparaissent pas'),
                        ul(
                            'Un bug que personne n’a encore trouvé, dans les contrats, dans la chaîne ou dans un portefeuille.',
                            'Le risque de marché : le piège décrit plus haut pour ceux qui fournissent, le mouvement des prix pour ceux qui échangent, et le peu d’activité d’un marché jeune.',
                            'Le risque de pont : un jeton ponté ne vaut que ce que vaut le pont qui garde la vraie pièce.',
                            'Le risque de jeton : n’importe qui peut créer un jeton et l’appeler comme il veut. Qu’un pool existe ne dit rien sur l’honnêteté du jeton qui est dedans.',
                            'Les pannes ordinaires : notre serveur ou la connexion à la chaîne peuvent prendre du retard ou s’arrêter. On continue d’échanger, mais les chiffres de la page peuvent être périmés.'
                        )
                    ]
                }
            ]
        },
        {
            id: 'business',
            label: 'Partie II',
            title: 'Le plan',
            lede: 'Pour qui c’est fait, comment ça se finance, et ce qui sera construit ensuite.',
            sections: [
                {
                    id: 'vision',
                    title: 'Ce que nous essayons de faire',
                    blocks: [
                        p('Où nous voulons arriver : que Nura Chain ait son propre marché, un endroit où n’importe qui, de n’importe où, peut valoriser et échanger n’importe quel jeton de la chaîne, sans personne au milieu.'),
                        p('Comment y arriver : construire et faire tourner la plateforme sur laquelle la chaîne s’appuie. Les contrats les plus fiables, les meilleures données de prix, et un site que les gens lisent dans leur langue, financé par une commission petite, visible et appliquée par le contrat, pas par nous.'),
                        p('Nura Swap, c’est de la plomberie. Il réussit quand d’autres choses se construisent dessus : des portefeuilles qui cotent à travers lui, de nouveaux jetons qui démarrent dessus, des applications qui y lisent leurs prix.')
                    ]
                },
                {
                    id: 'market',
                    title: 'Pour qui c’est fait',
                    blocks: [
                        p('Nura Chain en est au stade où son économie est encore en train de se former. La pièce a des détenteurs, le pont fait passer BNB et USDT, et d’autres jetons arriveront à mesure que des projets démarrent. Tous ont d’abord besoin de la même chose : un endroit où échanger. Celui qui le fournit en premier a tendance à le garder, parce que les échanges attirent l’argent, l’argent attire les échanges, et les deux ensemble attirent tout ce qui serait pénible à déplacer plus tard.'),
                        h3('Quatre sortes de gens'),
                        table(
                            ['Qui', 'Ce dont ils ont besoin', 'Ce qu’ils trouvent ici'],
                            [
                                ['Ceux qui détiennent du NURA', 'Un moyen de circuler entre NURA, dollars et pièces pontées sans ouvrir de compte nulle part', 'Des échanges depuis leur propre portefeuille, dans leur langue, avec des limites appliquées par le contrat'],
                                ['Ceux qui ont des jetons qui dorment', 'Un rendement sur des jetons qui ne font rien, sans en perdre le contrôle', 'Alimenter un pool, choisir la plage et le niveau de commission, encaisser quand ils veulent'],
                                ['Les nouveaux projets sur Nura Chain', 'Un marché pour leur jeton dès le premier jour, sans demander la permission à personne', 'N’importe qui peut créer un pool à n’importe quel niveau ; il est listé et tracé automatiquement'],
                                ['Portefeuilles et autres applications', 'Des prix et des échanges sur lesquels bâtir', 'Un service de données public, un cotateur et un routeur sur la chaîne, et un site qu’ils peuvent copier ou intégrer']
                            ]
                        ),
                        h3('Pourquoi ici, et pourquoi maintenant'),
                        ul(
                            'Il n’y a encore personne. Aucune plateforme installée à déloger, et la communauté parle déjà les langues dans lesquelles le site sort.',
                            'Le pont est la porte d’entrée. Les BNB et USDT qui arrivent sur Nura Chain ont besoin d’un endroit pour rencontrer NURA, et c’est ici.',
                            'Nura Wallet livre un connecteur pour cette plateforme, donc le portefeuille de la chaîne amène ses utilisateurs directement ici.'
                        )
                    ]
                },
                {
                    id: 'value',
                    title: 'Comment le projet se finance',
                    blocks: [
                        p('Une plateforme comme celle-ci crée de la valeur à trois endroits en même temps. Ceux qui ont des jetons qui dorment en tirent quelque chose. Ceux qui échangent obtiennent un prix sans avoir besoin de quelqu’un en face. Et toute la chaîne obtient un chiffre pour ce que valent les choses. Nura Swap prend une part du premier, grâce à un interrupteur déjà présent dans les contrats.'),
                        h3('La commission de protocole'),
                        p('Le modèle d’Uniswap permet au propriétaire du factory d’activer une commission de protocole sur un pool : entre un dixième et un quart de la commission que l’échange payait déjà. Elle est prise dans la commission, pas ajoutée par-dessus, donc celui qui échange paie exactement pareil dans les deux cas ; cette part va simplement ailleurs. Elle s’accumule dans le pool, dans les jetons échangés, jusqu’à ce qu’on la retire. Aujourd’hui elle est éteinte sur tous les pools.'),
                        p('Le plan est de la laisser éteinte tant que la plateforme rassemble encore de la liquidité, puis de l’allumer doucement (les pools les plus profonds d’abord, au réglage le plus bas) une fois que ceux qui fournissent gagnent correctement, et seulement après l’avoir annoncé à l’avance. Chaque changement est une transaction publique depuis une adresse connue, et n’importe qui peut la voir sur l’explorateur.'),
                        h3('Ce que ça représente'),
                        table(
                            ['Si une journée d’échanges fait', 'Les fournisseurs gagnent', 'La part du projet', 'Sur un an'],
                            [
                                ['100 000 $', '300 $', '60 $', '21 900 $'],
                                ['1 000 000 $', '3 000 $', '600 $', '219 000 $'],
                                ['10 000 000 $', '30 000 $', '6 000 $', '2 190 000 $']
                            ],
                            [0, 1, 2, 3]
                        ),
                        p('Ce sont des exemples au niveau 0,30 % avec une part d’un cinquième, pas des prévisions : le vrai chiffre dépend des pools qui portent l’activité. C’est la forme qui compte. Le revenu grandit avec les échanges, il coûte aux fournisseurs une fraction de ce qu’ils gagnent et rien du tout à ceux qui échangent, et il n’a besoin ni de jeton, ni d’abonnement, ni des dépôts de qui que ce soit pour fonctionner.'),
                        h3('D’autres entrées'),
                        ul(
                            'Aider les nouveaux projets à démarrer correctement : choisir le niveau de commission, monter le premier pool, mener une campagne de récompenses ; facturé au projet.',
                            'Fournir les données de prix comme service aux portefeuilles et aux tableaux de bord, le serveur lui-même restant libre pour qui veut le faire tourner soi-même.',
                            'Des subventions de Nura Chain pour l’infrastructure dont la chaîne a besoin et que ce projet est bien placé pour construire : routage, flux de prix, analytique.'
                        ),
                        callout('Il n’existe pas de jeton Nura Swap', 'Ce projet n’a pas de jeton à lui et n’en a pas besoin. NURA paie les transactions, les commissions arrivent dans ce qui a été échangé, et la commission de protocole se récolte de la même façon. Il n’y a ni vente, ni prévente, ni airdrop prévu. Si cela changeait un jour, ce serait annoncé sur les canaux du projet lui-même, jamais par quelqu’un d’autre, et jamais en message privé.')
                    ]
                },
                {
                    id: 'go-to-market',
                    title: 'Comment nous le faisons grandir',
                    blocks: [
                        steps(
                            { title: 'Lancement : déjà fait', text: 'La plateforme en ligne sur Nura Chain avec WNURA, Bridge BNB et Bridge USDT ; le serveur et ses données ; le site en dix langues ; le connecteur Nura Wallet ; la version 1.3.0.' },
                            { title: 'Amener les premiers fournisseurs', text: 'Apprendre aux gens, en persan et en anglais, ce qu’est vraiment une plage et comment lire une position, et travailler avec Nura Chain sur des récompenses pour les deux pools sur lesquels le marché repose : NURA contre USDT et NURA contre BNB.' },
                            { title: 'Rencontrer chaque nouveau projet', text: 'Parler à chaque équipe qui lance un jeton sur Nura Chain avant son lancement : le bon niveau de commission, un premier pool, un listing et un graphique dès le premier jour.' },
                            { title: 'Être intégré partout ailleurs', text: 'Mettre notre cotateur et nos données devant les portefeuilles, les explorateurs et les tableaux de bord, pour que le prix de cette plateforme devienne le prix de la chaîne, et son routeur la façon normale d’échanger.' },
                            { title: 'Grandir', text: 'Approfondir les pools, ajouter des jetons à mesure que le pont grandit, activer la commission de protocole et la dépenser sur la feuille de route.' }
                        ),
                        h3('Où nous touchons les gens'),
                        ul(
                            'Les lieux de la chaîne elle-même : Nura Wallet, l’explorateur, et la communauté Nura Chain sur Telegram, Discord, X et Instagram.',
                            'La documentation et ce document, dans les langues que la communauté lit vraiment.',
                            'Être en open source est en soi un canal : un site que n’importe qui peut copier rend peu coûteux de bâtir sur cette plateforme.'
                        )
                    ]
                },
                {
                    id: 'roadmap',
                    title: 'Ce qui vient ensuite',
                    blocks: [
                        p('Une direction, pas une promesse. Les choses avancent au rythme de la chaîne et de la communauté. Ce qui est vraiment sorti est noté dans le changelog, qui est public.'),
                        table(
                            ['Quand', 'Quoi'],
                            [
                                ['Fait : 3e trimestre 2026', 'La plateforme elle-même ; les pages échange, liquidité et portefeuille ; le serveur de données ; dix langues dont celles de droite à gauche ; le connecteur Nura Wallet ; une application installable'],
                                ['4e trimestre 2026', 'Un audit externe de ce déploiement ; échanger par deux pools à la fois quand ça donne un meilleur prix ; plus d’historique et de rendements par pool ; ce document en davantage de langues'],
                                ['1er semestre 2027', 'Activer la commission de protocole et la politique qui va avec ; un programme de récompenses avec Nura Chain ; des plages utilisées comme ordres limités simples ; de meilleurs outils pour gérer les positions ; plus de jetons pontés à mesure que le pont en ajoute'],
                                ['2e semestre 2027', 'Une boîte à outils pour que portefeuilles et applications bâtissent dessus ; passer la clé du propriétaire derrière un compte multisignature aux signataires publiés ; proposer les prix des pools comme flux sur lequel d’autres applications de Nura Chain peuvent s’appuyer']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'governance',
                    title: 'Qui peut changer quoi',
                    blocks: [
                        p('Les contrats ne peuvent pas changer, donc il reste très peu de choses à gouverner. Une clé, celle du propriétaire du factory, a exactement deux pouvoirs : ajouter un nouveau niveau de commission et activer la commission de protocole sur un pool. Elle ne peut ni arrêter un pool, ni prendre d’argent, ni modifier un niveau de commission existant, ni toucher à la position de quiconque. Les deux pouvoirs s’exercent en public, sur la chaîne, où tout le monde les voit.'),
                        facts(
                            { label: 'La clé du propriétaire', value: '0x4ac0d9300422b408bA2AbF47995C87cF32763712', mono: true },
                            { label: 'Elle peut', value: 'Ajouter un niveau de commission ; activer la commission de protocole sur un pool' },
                            { label: 'Elle ne peut pas', value: 'Mettre quoi que ce soit en pause, changer le code, ou déplacer un seul jeton' }
                        ),
                        p('Le site et le serveur sortent par le dépôt public avec un changelog, et chaque version doit passer les mêmes contrôles avant d’être publiée. Le serveur indique s’il est en bonne santé et à quel point il est à jour, donc les problèmes se voient vite. Le support et les annonces passent par les canaux listés à la fin de ce document, et nulle part ailleurs.')
                    ]
                },
                {
                    id: 'metrics',
                    title: 'Comment savoir si ça marche',
                    blocks: [
                        p('Vous n’avez à nous croire sur rien de tout ceci. La page d’accueil montre l’argent dans les pools, l’activité du dernier jour et le nombre de pools, en direct. Chaque chiffre ci-dessous vient de ces mêmes données publiques, et n’importe qui peut les lire.'),
                        table(
                            ['Ce que nous surveillons', 'Pourquoi ça compte'],
                            [
                                ['L’argent dans les pools', 'Quelle taille d’échange le marché encaisse sans vaciller'],
                                ['Les échanges des dernières 24 heures', 'À quel point c’est actif, et avec quoi grandirait une future commission'],
                                ['Pools et jetons listés', 'Quelle part de la chaîne est vraiment échangeable'],
                                ['Les fournisseurs, et combien sont dans leur plage', 'Si ceux qui financent les pools s’en sortent bien'],
                                ['Ce que les fournisseurs ont gagné', 'Si alimenter un pool en vaut la peine'],
                                ['Portefeuilles et applications bâtis dessus', 'Si la plateforme fait désormais partie du décor']
                            ]
                        )
                    ]
                },
                {
                    id: 'risks',
                    title: 'Ce qui peut mal tourner dans le plan',
                    blocks: [
                        ul(
                            'Une croissance lente. L’économie d’une chaîne peut mettre plus de temps que tout le monde l’espérait, et il n’y a pas de revenu sur des échanges qui n’ont pas lieu.',
                            'La concurrence. N’importe qui peut copier ce code et ouvrir un rival. La défense, c’est la profondeur, les intégrations et la confiance, pas le secret, que l’open source exclut de toute façon.',
                            'Le pont. La première valeur extérieure arrive par lui, donc un ennui sur le pont est un ennui pour les jetons valorisés à travers lui.',
                            'La réglementation. Les règles pour ce type de plateforme diffèrent d’un pays à l’autre et changent sans arrêt. Nous pouvons adapter la façon dont le projet fonctionne ; nous ne pouvons pas adapter les contrats, parce que personne ne le peut.',
                            'La clé. Tant que la clé du propriétaire n’est pas derrière un compte multisignature, quelqu’un qui la volerait pourrait activer la commission de protocole. Il ne pourrait toujours pas déplacer un seul jeton.',
                            'La sécurité. Un bug non découvert dans les contrats, la chaîne ou un portefeuille pourrait coûter de l’argent aux gens. L’audit prévu réduit ce risque. Rien ne le supprime.'
                        )
                    ]
                },
                {
                    id: 'contracts',
                    title: 'Annexe A : Les adresses',
                    blocks: [
                        p('Voici ce qui est en ligne sur Nura Chain en ce moment, tiré du fichier décrit plus haut. Si vous interagissez un jour directement avec l’un d’eux, vérifiez-le d’abord sur l’explorateur.'),
                        table(
                            ['Ce que c’est', 'Adresse'],
                            [
                                ['Factory : crée les pools', '0x88E8bB62E1654e695043FD5416D5E5415AFFd39b'],
                                ['Routeur : fait les échanges', '0x98b52fB699F1F91494b2937fECf109f8E09570Ae'],
                                ['Cotateur : répond « combien je recevrais ? »', '0x4b6f7C7d1337F6C6A624677688EA8035c3Ed6782'],
                                ['Gestionnaire de positions : vos reçus', '0xcf00BFaA3c292205D38d37f9086c4F3838339Fbb'],
                                ['Tick lens : lit l’échelle', '0xbFdA09e0D89ABa201491F81dcD0993Fd223e66A0'],
                                ['WNURA : NURA sous forme de jeton', '0xf0a4eC07916feBa4432121Ed5969887D9b939cD0'],
                                ['Multicall : beaucoup de questions d’un coup', '0xf58884FCf45d8F5Cc8A73c618D23EB27b732CA24'],
                                ['Bridge BNB', '0xD4221Ad9772BF5bA7423a044bBBEe6af2154A5Fc'],
                                ['Bridge USDT', '0x4E0DB0B1Da408faF5637202CF48b0bc7733bE6dC'],
                                ['La clé du propriétaire', '0x4ac0d9300422b408bA2AbF47995C87cF32763712']
                            ],
                            [1]
                        ),
                        facts(
                            { label: 'Id de chaîne', value: '1020', mono: true },
                            { label: 'Déployé au bloc', value: '124110', mono: true },
                            { label: 'Décimales', value: '18, sur chaque jeton listé', mono: true }
                        )
                    ]
                },
                {
                    id: 'glossary',
                    title: 'Annexe B : Les mots employés ici',
                    blocks: [
                        table(
                            ['Mot', 'Ce que ça veut dire'],
                            [
                                ['AMM', 'Teneur de marché automatique : un contrat qui donne un prix à partir de ce qu’il détient, au lieu d’apparier acheteurs et vendeurs.'],
                                ['Pool', 'Un contrat qui détient deux jetons à un niveau de commission. Une paire peut en avoir jusqu’à quatre.'],
                                ['Niveau de commission', 'Ce qu’un pool prélève sur chaque échange : 0,01 %, 0,05 %, 0,30 % ou 1,00 %.'],
                                ['Tick', 'Un barreau de l’échelle des prix. Chaque barreau est 0,01 % au-dessus du précédent.'],
                                ['Espacement des ticks', 'Le nombre de barreaux qu’un niveau de commission impose entre les bouts d’une plage : 1, 10, 60 ou 200.'],
                                ['sqrtPriceX96', 'Le prix du pool, gardé sous forme de racine carrée et stocké en entier pour que rien ne soit arrondi.'],
                                ['Liquidité (L)', 'La quantité d’argent derrière le prix : la profondeur du pool au barreau où il se trouve.'],
                                ['Position', 'Votre reçu pour avoir alimenté un pool : quel pool, quelle plage, combien.'],
                                ['Dans la plage', 'Le prix est entre les deux bouts de votre plage, donc vous détenez les deux jetons et vous gagnez des commissions.'],
                                ['Impact sur le prix', 'De combien votre propre échange pousse le prix, avant commission.'],
                                ['Tolérance au glissement', 'Le pire prix que vous acceptez. Au-delà, le contrat annule l’échange.'],
                                ['Échéance', 'Le moment après lequel le contrat refuse tout simplement d’exécuter votre échange.'],
                                ['Cotateur', 'Un contrat qui fait semblant d’échanger et indique ce que vous recevriez, sans le faire.'],
                                ['Routeur', 'Le contrat qui exécute les échanges, en emballant et déballant NURA au besoin.'],
                                ['Gestionnaire de positions', 'Le contrat qui émet, modifie et ferme les positions, et verse leurs commissions.'],
                                ['WNURA', 'NURA sous forme de jeton, échangeable un pour un, parce que les pools ne peuvent détenir que des jetons.'],
                                ['Commission de protocole', 'Une part facultative de la commission d’échange que le propriétaire du factory peut rediriger vers le projet.'],
                                ['Perte impermanente', 'Finir avec moins que si vous aviez simplement gardé vos deux jetons sans rien faire.'],
                                ['TVL', 'Valeur totale bloquée : ce que vaut tout ce qui est dans les pools, en ne comptant que les prix que nous pouvons ancrer.'],
                                ['Indexeur', 'Notre serveur : il suit les contrats et garde l’historique que le site affiche.']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'links',
                    title: 'Annexe C : Où nous trouver',
                    blocks: [
                        table(
                            ['Quoi', 'Où'],
                            [
                                ['Code source : site, serveur et maths', 'https://github.com/NuraChain/Swap'],
                                ['Point de connexion Nura Chain', 'https://rpc.nurachain.net'],
                                ['Explorateur de blocs', 'https://explorer.nurachain.net'],
                                ['X', 'https://x.com/nurachainnet'],
                                ['Discord', 'https://discord.gg/8BMAXTdXQg'],
                                ['Telegram', 'https://t.me/nurachain'],
                                ['Instagram', 'https://www.instagram.com/nura.chain/']
                            ],
                            [1]
                        ),
                        ol(
                            'Adams, Zinsmeister, Salem, Keefer, Robinson : Uniswap v3 Core (2021). L’article d’où viennent les maths de cette plateforme.',
                            'Le dépôt Nura Swap : README, CHANGELOG et TESTING, pour les parties du système décrites ici.'
                        )
                    ]
                }
            ]
        }
    ]
};
