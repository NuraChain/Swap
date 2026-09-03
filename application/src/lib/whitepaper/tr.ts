// The whitepaper, Turkish. Section ids and block shapes mirror en.ts exactly -
// tests/whitepaper.spec.ts holds all ten languages to the same outline.
//
// Register: plain, spoken Turkish. Short sentences, everyday words.

import { callout, facts, formula, h3, ol, p, steps, table, ul } from './model.ts';
import type { Whitepaper } from './model.ts';

export const tr: Whitepaper = {
    meta:
    {
        title: 'Nura Swap',
        subtitle: 'Teknik doküman',
        version: 'Teknik doküman v1.2',
        date: 'Eylül 2026',
        covers: 'Nura Chain üzerindeki 1.3.0 uygulama sürümünü anlatır (zincir kimliği 1020).',
        abstractTitle: 'Kısaca',
        disclaimerTitle: 'Lütfen bunu okuyun',
        disclaimer: 'Bu doküman Nura Swap’in nasıl çalıştığını ve bundan sonra ne kurmayı umduğumuzu anlatır. Yatırım tavsiyesi değildir. Hiçbir şeyin satış teklifi değildir. Hiçbir kazanç vaat etmez. Hem işlem yapmanın hem de bir havuza para koymanın gerçek riski vardır ve koyduğunuz her şeyi kaybedebilirsiniz. Buradaki planlar niyettir, söz değil, ve değişebilir.'
    },
    abstract: [
        'Nura Swap, Nura Chain üzerinde yaşayan bir takas makinesidir. Bir tokeni başka bir tokenle değiştirir ve araya kimse girmez. Paranızı tutan bir şirket yoktur. Kimse sizi onaylamaz. Açılacak bir hesap da yoktur. Paranız baştan sona kendi cüzdanınızda kalır.',
        'İşin sırrı havuz. Havuz, içinde iki tür token bulunan ortak bir kaptır ve fiyatını içindekilere bakarak kendisi bulur. Kaba token koyan herkes, oradan geçen her işlemden küçük bir komisyon kazanır. Bütün fikir bu. Dokümanın geri kalanı ayrıntı.',
        'Nura Swap üç parçadan oluşur: takası yapan zincir üstündeki sözleşmeler, fiyatları ve geçmişi tutan küçük bir sunucu, ve on dilde okuyabildiğiniz bu site. Birinci bölüm makinenin nasıl çalıştığını anlatır. İkinci bölüm masrafını nasıl çıkarmayı ve büyütmeyi düşündüğümüzü anlatır.'
    ],
    parts: [
        {
            id: 'protocol',
            label: 'Birinci bölüm',
            title: 'Borsa nasıl çalışıyor',
            lede: 'Token dolu kaptan başlayın, gerisi kendiliğinden gelir.',
            sections: [
                {
                    id: 'introduction',
                    title: 'Bir zincirin neden takas makinesine ihtiyacı var',
                    blocks: [
                        p('Yeni bir zincir, yeni bir kasaba gibidir. Paralar vardır ama alınıp satılacak bir yer yoktur, o yüzden kimse ne ettiğini bilmez. Birinin dükkân açması gerekir.'),
                        p('Eski usul dükkân, emir defteridir: almak isteyenlerle satmak isteyenlerin uzun bir listesi. Ancak siz işlem yapmak istediğiniz anda karşı tarafta biri duruyorsa işe yarar. Ve genellikle liste eşleşirken herkesin parasını tutacak bir şirket gerekir. Genç bir zincirde karşı tarafta genelde kimse olmaz. Paranızı bir şirkete teslim etmek de zaten blok zincirin önlemeye çalıştığı şeydir.'),
                        p('Nura Swap işi tersinden yapar. İki kişiyi eşleştirmek yerine, içinde iki tür token olan bir kap tutar. Siz kapla işlem yaparsınız. Bir tokeni koyar, diğerini alırsınız; fiyatı kap kendisi hesaplar. Hep açıktır, asla hayır demez ve size ait hiçbir şeyi işleminizin sürdüğü birkaç saniyeden fazla tutmaz.'),
                        p('Kabın içindeki matematik bizim değil. Nura Swap, UniswapV3’ü yazıldığı gibi çalıştırır: türünün en çok kullanılan ve en çok denetlenen kodu. Bizim kurduğumuz şey, bu zincir için onun etrafındaki her şey: kurulum, fiyat verisi, on dilde site ve ikinci bölümdeki plan.')
                    ]
                },
                {
                    id: 'nura-chain',
                    title: 'Tek sayfada Nura Chain',
                    blocks: [
                        p('Nura Chain, bütün bunların üstünde çalıştığı ağ. Yaklaşık her üç saniyede bir yeni blok yazılır ve yazıldığı anda iş biter: tutup tutmayacağını beklemek yok. Yani takasınız, bloğu göründüğü anda tamamlanmış olur. Zincir Ethereum ile aynı dili konuşur, bu yüzden Ethereum için yapılmış cüzdanlar ve araçlar burada hiçbir değişiklik olmadan çalışır.'),
                        facts(
                            { label: 'Zincir kimliği', value: '1020', mono: true },
                            { label: 'Parası', value: 'NURA (18 ondalık)', mono: true },
                            { label: 'Sarmalanmış hâli', value: 'WNURA, her zaman 1:1', mono: true },
                            { label: 'Bloklar nasıl karara bağlanır', value: 'CometBFT - yazılan blok kesindir' },
                            { label: 'Yeni blok aralığı', value: '≈ 3 sn', mono: true },
                            { label: 'Bağlantı noktası', value: 'https://rpc.nurachain.net', mono: true },
                            { label: 'Blok gezgini', value: 'https://explorer.nurachain.net', mono: true },
                            { label: 'Başlangıçtaki tokenler', value: 'WNURA, Bridge BNB, Bridge USDT' }
                        ),
                        p('NURA zincirin kendi parasıdır ve her işlemin küçük ücretini o öder. Ama bir havuz yalnızca ERC-20 türü token tutabilir, NURA ise o türden değil. Bu yüzden NURA’ya WNURA adında bir fiş verilir: bir NURA verirsiniz, bir WNURA alırsınız ve istediğiniz zaman geri çevirirsiniz. Site bunu işleminizin içinde yapar, siz yalnızca NURA görürsünüz. Havuzlar WNURA sürümünü tutar.'),
                        p('İki token başka zincirlerden bir köprüyle gelir: Bridge BNB ve Bridge USDT. Her biri, kendi zincirinde kilitli duran gerçek paranın üstündeki bir haktır. İki sebepten önemliler. Dışarıdan değer getirirler. Ve bir dolar tokeni her yerde aşağı yukarı bir dolar ettiği için, zincire her şeyin değerini ölçecek ilk dürüst cetveli verirler.')
                    ]
                },
                {
                    id: 'principles',
                    title: 'Kendimize koyduğumuz kurallar',
                    blocks: [
                        ul(
                            'Paranız sizin kalır. Cüzdanınız imzalamadan hiçbir şey kımıldamaz. Sitede ne mevduat vardır, ne anahtar, ne de giriş hesabı.',
                            'Kurallar değiştirilemez. Sözleşmelerin güncelleme düğmesi ve kapatma anahtarı yoktur; ne bizim için ne de başkası için. Bugün ne yapıyorlarsa on yıl sonra da onu yapacaklar.',
                            'Ödünç alınmış matematik, binlerce kişi tarafından denetlenmiş. Fiyatlama UniswapV3’ünkidir, sitemize ve sunucumuza rakam rakam kopyalanmıştır; yani okuduğunuz sayı havuzun kullanacağı sayıdır.',
                            'Fiyatlar tahminden değil, havuzun kendisinden gelir. Bir havuzun neyi tuttuğunu saymak pek bir şey söylemez, o yüzden her seferinde doğrudan havuza sorarız.',
                            'Sınırlarınızı biz değil, sözleşme uygular. Kabul ettiğiniz en kötü fiyatı ve ne kadar süre tanıdığınızı siz söylersiniz. İkisinden biri çiğnenirse işlem hiç gerçekleşmez.',
                            'Her şey herkese açık. Site, sunucu ve matematik açık kaynak; bütün sözleşme adreslerini listeleyen dosya da isteyen okusun diye depoda duruyor.',
                            'Kullanan insanlar için yazılmış. On dil, ikisi sağdan sola, kendi rakamlarıyla. Bir sayfa, Farsça da İngilizce kadar dikkatle gözden geçirilmeden bitmiş sayılmaz.'
                        )
                    ]
                },
                {
                    id: 'concentrated-liquidity',
                    title: 'Havuz fiyatı nasıl belirliyor',
                    blocks: [
                        p('İçinde iki tür token olan bir kap düşünün, diyelim NURA ve dolar. NURA almak için dolar koymanız gerekir. Kabın içinde NURA azalır, kap da bir sonraki için daha fazlasını ister. Çok alırsanız fiyat siz aldıkça yükselir. Bütün fiyat kuralı bu: azalan pahalanır.'),
                        p('Eski tasarım, kabın parasını olabilecek bütün fiyatlara yayardı; neredeyse sıfırdan neredeyse sonsuza. Çoğu, kimsenin asla işlem yapmayacağı fiyatlarda otururdu; kimsenin giymediği bedenlerle dükkân doldurmak gibi. Nura Swap bir fiyat aralığı seçip paranızı sadece oraya koymanıza izin verir. Aralığınızın içinde paranız çok daha fazla çalışır. Dışında kıpırdamadan bekler.'),
                        h3('Fiyatlar bir merdivenin basamaklarında durur'),
                        p('Buradaki fiyatlar düz bir çizgi değil. Bir merdivenin basamakları. Her basamak bir altındakinden yüzde birin yüzde biri kadar yukarıdadır; fark edilemeyecek kadar küçük. Ve her aralık bir basamakta başlayıp bir basamakta biter. Basamaklara tick denir. Havuz fiyatını karekök olarak, tam sayı biçiminde saklar; çünkü bilgisayarlar tam sayıları kusursuz toplar ve yolda kesir kaybetmez.'),
                        formula('price(i) = 1.0001^i          sqrtPriceX96 = √price × 2^96', 'i numaralı basamak, 1,0001’in kendisiyle i kez çarpılması demek. Fiyat ister küçücük olsun ister devasa, her basamak %0,01’lik bir adımdır.'),
                        h3('Asıl önemli olan derinlik'),
                        p('Aralığı şu anki fiyatı kapsayan herkesi toplayın; havuzun o fiyattaki derinliğini bulursunuz. Havuz buna L der. Bir işlemin fiyatı ne kadar oynatacağına derinlik karar verir.'),
                        formula('x · y = L²          Δ√P = Δy / L          Δ(1/√P) = Δx / L', 'L büyüdükçe oynama küçülür. Havuz, girdinize ve derinliğe bakarak tam çıktınızı hesaplar; birinin aralığının ucunu aştığında bir sonraki basamağa geçer.'),
                        p('Yani havuzun büyüklüğü asıl mesele değil; paranın nerede durduğu daha önemli. Parası fiyatın çevresine sıkıca yığılmış küçük bir kap, büyük bir işlemi kılı kıpırdamadan kaldırır. Parası her yere saçılmış daha büyük bir kap kaldıramaz.'),
                        h3('Komisyon nereye gidiyor'),
                        p('Her işlem küçük bir komisyon öder. Bu komisyon, o anda aralığı fiyatı kapsayan kişiler arasında, her birinin oraya koyduğu miktarla orantılı olarak paylaşılır. Aralığınız fiyatı kapsamıyorsa o işlemden hiçbir şey kazanmazsınız. Havuz herkese tek tek ödeme yapmak yerine yürüyen bir toplam tutar; bu yüzden havuzu on kişi de beslese on bin kişi de beslese bir takasın maliyeti aynıdır. Komisyonlarınız siz gelip alana kadar havuzda bekler.'),
                        table(
                            ['Aralığınız', 'Paranız yaklaşık', 'Bu ne demek'],
                            [
                                ['±%2 genişlikteyse', '100× daha çok çalışır', 'En çok kazandıran, ama fiyat çabuk kaçar'],
                                ['±%10 genişlikteyse', '21× daha çok çalışır', 'Yavaş hareket eden bir çift için yaygın seçim'],
                                ['±%50 genişlikteyse', '5× daha çok çalışır', 'Çoğu sürprizi kaldıracak kadar geniş'],
                                ['bütün merdivense', 'Eskisi kadar çalışır', 'Kazanmayı hiç bırakmaz, hiç de çok kazanmaz']
                            ],
                            [0, 1]
                        ),
                        p('Karşılaştırma, aynı parayı bütün merdivene yaymakla yapılıyor ve yalnızca fiyat aralığınızın içinde kaldığı sürece geçerli. Değiş tokuş tek cümlede şu: ne kadar dar giderseniz o kadar çok kazanır ve o kadar erken durursunuz.')
                    ]
                },
                {
                    id: 'swap',
                    title: 'Takas yaptığınızda ne oluyor',
                    blocks: [
                        p('Takas tek bir işlemdir. Site hazırlar, siz imzalarsınız. Güvenli olması için siteye güvenmeniz gerekmez: önemli olan her sayı ya zincirden okunur ya da tokenleriniz kımıldamadan önce sözleşme tarafından denetlenir.'),
                        steps(
                            { title: 'Cüzdanınızı bağlayın', text: 'Neredeyse her tarayıcı cüzdanı çalışır (MetaMask, Rabby, Trust ve diğerleri) ve Nura Wallet kendi bağlantısıyla bağlanır. Bağlanmak siteye yalnızca elinizde olanı okuma izni verir. İmzanız olmadan hiçbir şey kımıldamaz.' },
                            { title: 'Fiyat alın', text: 'Bir çiftin dört havuza kadar havuzu olabilir; her biri farklı komisyon alır. Site hepsine ne alacağınızı sorar ve en iyi cevabı size sunar. Soru bize değil zincire gider, yani gördüğünüz sayı havuzun size gerçekten vereceği sayıdır.' },
                            { title: 'Sınırlarınızı koyun', text: 'Kabul edeceğiniz en kötü fiyatı ve teklifin ne kadar geçerli kalacağını siz seçersiniz. Site ayrıca kendi işleminizin fiyatı ne kadar ittiğini gösterir. Bu itiş %15’i aşarsa durur ve bilerek onaylamanızı ister.' },
                            { title: 'İzin verin', text: 'Bir tokeni ilk kez harcarken o miktar için izin verirsiniz. Varsayılan olarak tam miktarı isteriz. İsterseniz sınırsız izin de verebilirsiniz; bunun ne anlama geldiğini önceden açıkça söyleriz.' },
                            { title: 'Gönderin', text: 'Tek bir işlem tokeninizi alır, takas eder ve diğerini size verir. Sonuç sınırınızdan kötü çıkacaksa ya da süreniz dolduysa her şey iptal edilir. Tokenleriniz cüzdanınızdan hiç çıkmaz ve yalnızca ufacık ağ ücretini kaybedersiniz.' }
                        ),
                        h3('NURA’nın kendisini takaslamak'),
                        p('İşleminizin bir tarafı NURA olduğunda site onu girişte WNURA’ya, çıkışta yeniden NURA’ya çevirir; hepsi aynı işlemin içinde olur ve artan kırıntı size geri döner. NURA ile WNURA arasında gidip gelmek zaten işlem sayılmaz: bire birdir, komisyonsuzdur ve havuz gerektirmez.'),
                        h3('Bir şey ters giderse'),
                        p('Sözleşmenin verebileceği her ret, üzerine bir şey yapabileceğiniz bir cümleye çevrilir. İmzayı iptal edin, hiçbir şey gönderilmemiş olur. Fiyat sınırınızı aştıysa bunu söyler, daha az işlem yapmayı ya da sınırı genişletmeyi öneririz. Süre dolduysa hiçbir şey harcanmamıştır. Kefil olamadığımız bir token ise siz işlem yapmadan önce etiketlenir; çünkü herkes token yaratıp ona istediği adı verebilir.')
                    ]
                },
                {
                    id: 'liquidity',
                    title: 'Paranızı bir havuza koymak',
                    blocks: [
                        p('Bir havuza para verdiğinizde bir makbuz alırsınız ve bu makbuz kendisi de sizin olan bir tokendir. Hangi havuz, hangi fiyat aralığı ve ne kadar olduğunu kaydeder. Yalnızca elinde tutan onu değiştirebilir ya da ondan tahsil edebilir; başka bir tokende olduğu gibi başkasına devredilebilir.'),
                        steps(
                            { title: 'Bir havuz seçin', text: 'Bir çiftin her komisyon kademesi için birer tane olmak üzere dört havuza kadar havuzu olabilir. Birbirine yakın seyreden iki token ucuz kademelere uyar. Oynak ya da az işlem gören çiftler %0,30 ve %1,00’e uyar; orada daha yüksek komisyon daha yüksek riski karşılar.' },
                            { title: 'Fiyat aralığınızı seçin', text: 'Kapsamak istediğiniz en düşük ve en yüksek fiyatı seçin ya da bütün merdiveni alın. Site iki ucu gerçek basamaklara oturtur, fiyatın şu an nerede olduğunu gösterir ve aralığınız tamamen bir tarafta kalıyorsa uyarır; çünkü o zaman aslında piyasa beslemiyor, emir giriyorsunuzdur.' },
                            { title: 'Parayı koyun', text: 'Aralığınız şu anki fiyatı kapsıyorsa havuz her iki tokene de ihtiyaç duyar; oran aralığınıza göre belirlenir. Bir miktarı yazın, site diğerini hesaplasın. İkisini de onaylar, bir özet görür, sonra tek bir işlemle iş biter.' },
                            { title: 'Kazanın ve yönetin', text: 'Fiyat aralığınızın içinde olduğu sürece her işlemden pay alırsınız. İstediğiniz zaman ekleyebilir, bir kısmını ya da hepsini geri çekebilir veya kazandığınızı tahsil edebilirsiniz. Paranızı çekmek kazancı da beraberinde alır.' }
                        ),
                        callout('İlk giren fiyatı belirler', 'Havuz henüz yoksa onu ilk yatırım yaratır ve o yatırımın ima ettiği fiyat havuzun fiyatı olur. Yanlış koyarsanız işlemciler aradaki farkı dakikalar içinde seve seve cebinizden alır. Site bunu açıkça söyler ve açılış fiyatını kendiniz yazmanızı ister.'),
                        h3('İşin püf noktası, sade dille'),
                        p('Bir havuzu beslemek, sonunda herkesin sattığı tokenden daha çok elinizde kalması demektir. Fiyat aralığınızın dışına çıkarsa ikisinden yalnızca biri elinizde kalır ve fiyat dönene kadar kazanmayı durdurursunuz. İki tokeni öylece tutup hiçbir şey yapmamakla karşılaştırıldığında, büyük bir hareketten sonra kazandığınız komisyonları saysanız bile daha kötü durumda olabilirsiniz. Komisyonlar bunu göze aldığınız için aldığınız ücrettir. Yeterli olup olmayacağı çifte, aralığınıza ve ne kadar işlem yapıldığına bağlı.')
                    ]
                },
                {
                    id: 'fees',
                    title: 'Komisyon ve kime gittiği',
                    blocks: [
                        p('Dört komisyon kademesi var ve kademe çifte değil havuza aittir. Aynı iki token her kademede bir havuza sahip olabilir; site seçim yapmadan önce hepsinden fiyat sorar.'),
                        table(
                            ['Komisyon', '1.000 $’lık işlemde', 'Aralık uçları arası basamak', 'Şuna uygun'],
                            [
                                ['%0,01', '0,10 $', '1', 'Birbirinden neredeyse hiç ayrılmayan iki token'],
                                ['%0,05', '0,50 $', '10', 'Dolar tokenleri ve büyük çiftler'],
                                ['%0,30', '3,00 $', '60', 'Çiftlerin çoğu'],
                                ['%1,00', '10,00 $', '200', 'Yeni, oynak ya da az işlem gören tokenler']
                            ],
                            [0, 1, 2]
                        ),
                        p('Bugün bu komisyonun her kuruşu havuzu besleyenlere gidiyor. Uniswap tasarımı ayrıca bir protokol komisyonuna izin verir: aynı komisyonun onda biri ile dörtte biri arasında bir dilim, fabrika sözleşmesinin sahibine gider. Bütün havuzlarda kapalıdır ve onunla ne yapmayı düşündüğümüz ikinci bölümde anlatılıyor. Ne site ne de sunucu bunun üstüne kendinden bir şey almaz.')
                    ]
                },
                {
                    id: 'architecture',
                    title: 'Bütün bunlar nasıl kurulmuş',
                    blocks: [
                        p('Üç parça ve onları birbirine bağlayan küçük bir dosya.'),
                        table(
                            ['Parça', 'Ne yapar', 'Nerede yaşar'],
                            [
                                ['Sözleşmeler', 'Havuzları tutar, takasları yapar, kimin ne verdiğinin hesabını tutar', 'Nura Chain üzerinde - değiştirilemez'],
                                ['Sunucu', 'Sözleşmeleri izler ve geçmişi tutar: fiyatlar, grafikler, hacim, son işlemler', 'Küçük tek bir makine'],
                                ['Site', 'Gördüğünüz ve tıkladığınız her şey', 'Tarayıcınız - ana sayfa ve bu doküman önceden üretilir']
                            ]
                        ),
                        h3('Hepsini birbirine bağlayan dosya'),
                        p('Sözleşmeler ayrı bir depoda geliştiriliyor. Bu projenin oradan aldığı tek şey, zinciri, adresleri ve tokenleri listeleyen küçük bir dosya. Sunucu o dosyayı okur ve tarayıcınıza verir; yani sitenin içine gömülü hiçbir adres yok. Borsa bir gün yeniden kurulursa tek bir dosya değişir, gerisi peşinden gelir.'),
                        h3('Zincire doğrudan ne soruyoruz'),
                        p('İşleminizin bağlı olduğu her şey sunucumuzdan değil, canlı olarak zincirden okunur: havuzun fiyatı, teklif, bakiyeleriniz, izinleriniz, pozisyonlarınız. Sayfa hızlı açılsın diye hepsi tek pakette gider. Site ayrıca her sözleşmenin hangi sürümünün gerçekten kurulu olduğunu varsaymak yerine denetler; çünkü yanlış bir varsayım sessizce bozuk bir işlem üretirdi.'),
                        h3('Sunucu ve neden var olduğu'),
                        p('Bazı şeyler olsa hoş olur ama hiçbir işlem onlara bağlı değildir: havuz listesi, fiyat grafiği, dün ne kadar işlem olduğu, kendi geçmişiniz. Bunlar sunucumuzdan gelir. Sunucu sözleşmeleri olayları yayınladıkça takip eder, kaydeder ve grafiğin her saatini işlemlerin kendi bildirdiği verilerle fiyatlandırır. Bu zincirde blok hemen kesinleştiği için hiç beklemez. Zincir sıfırlanırsa ya da borsa yeniden kurulursa bunu fark eder ve baştan başlar. Ayrıca ne kadar geride kaldığını bildirir; bu gecikme göze batmaya başlayınca site bir şerit gösterir.'),
                        h3('Dolar cinsinden fiyatlar'),
                        p('Dolar rakamları sayfayı okumanızı kolaylaştırmak için var ve bir işlemi gerçekleştirmek için asla kullanılmaz. Dolar tokeni bir dolar sayılır. Köprülenmiş bir token kendi zincirinde ne ediyorsa onu eder; buradaki hiçbir havuz bunu bilemez, o yüzden o fiyat dışarıdan gelir. Geri kalan her şey, onu bu ikisinden birine bağlayan en derin havuz üzerinden iki geçişte fiyatlanır; böylece yalnızca NURA karşılığında işlem gören bir token de fiyat alır. Kilitli değer gibi toplamlarda yalnızca izi gerçek bir çıpaya çıkan tokenler sayılır; yoksa bir havuz uydurduğu bir fiyatla kendini zengin ilan edebilirdi.'),
                        h3('Sunucu neye cevap veriyor'),
                        table(
                            ['Şunu isteyin', 'Şunu alın'],
                            [
                                ['/api/market/stats', 'Havuz sayısı, toplam kilitli değer, 24 saatlik hacim ve ne kadar güncel olduğu'],
                                ['/api/market/pools', 'Her havuz: tokenleri, varlıkları, fiyatı, büyüklüğü, hacmi ve komisyon getirisi'],
                                ['/api/market/pools/:address', 'Tek bir havuz ve 72 saatlik grafik'],
                                ['/api/market/tokens', 'Dolar fiyatı olan her token ve o fiyatın çıpalı olup olmadığı'],
                                ['/api/market/txs', 'Son işlemler ve yatırımlar, cüzdana göre süzülebilir'],
                                ['/api/market/deployment', 'Yukarıda anlatılan adres dosyası'],
                                ['/api/healthz', 'Sunucunun ayakta olup olmadığı']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'application',
                    title: 'Site',
                    blocks: [
                        p('Site, gerçekten dokunduğunuz kısım. İnanılmak için değil denetlenmek için yapıldı: tamamı açık kaynak ve size hiçbir şeyi ona emanet etmenizi söylemez.'),
                        ul(
                            'Takas: her komisyon kademesinden fiyatlar, kendi işleminizin etkisi, sınırlarınız, önce izin sonra işlem, NURA’nın kendiliğinden hallolması, bir grafik ve son işlemler.',
                            'Likidite: her kademedeki havuzlar fiyat ve büyüklükleriyle; pozisyonlarınız aralıklarıyla ve kazanıp kazanmadıklarıyla; ekleme, çıkarma ve tahsil, her biri cüzdanınız sormadan önce bir özetle.',
                            'Portföy: neyiniz var ve ne ediyor, pozisyonlarınız ve zincir üzerindeki kendi geçmişiniz.',
                            'Cüzdanlar: bütün tarayıcı cüzdanları, geri döndüğünüzde sessiz yeniden bağlanma, Nura Wallet bağlantısı ve Nura Chain’i eklemek için tek düğme - ki ağınızı asla arkanızdan değiştirmez.',
                            'On dil: İngilizce, Farsça, Arapça, İspanyolca, Portekizce, Hintçe, Çince, Rusça, Fransızca ve Türkçe. Farsça ve Arapça sağdan sola okunur, kendi rakamlarıyla; tutarlar ve adresler her zaman normal yönünde kalır.',
                            'Açık ve koyu tema, klavyeyle seçtiğiniz şeyin etrafında net bir çerçeve ve cihazınız isterse daha sakin hareketler.',
                            'Ana sayfa ve bu doküman anında açılsın diye önceden üretilir; işlem sayfaları siz gidince yüklenir ve cüzdanınızın bulunduğu yerde, tarayıcınızda çalışır.'
                        )
                    ]
                },
                {
                    id: 'security',
                    title: 'Güvenlik ve yine de ters gidebilecekler',
                    blocks: [
                        h3('Sözleşmeler neyi garanti ediyor'),
                        ul(
                            'Matematik UniswapV3’ün, değiştirilmemiş. Havuz, yönlendirici ve pozisyon koduna dokunmadık; olduğu gibi kopyalandı ve sabit bir sürüme raptedildi.',
                            'Güncelleme düğmesi de paranızın üstünde bir yönetici de yok. Fabrika sahibi bir komisyon kademesi ekleyebilir ve protokol komisyonunu açabilir. Bir havuza ya da pozisyonunuza elini uzatamaz.',
                            'Fiyat sınırınızı ve süre sınırınızı sözleşme denetler. Bu sitenin yerine düşmanca bir kopya konsa bile o sınırlar yerinde kalırdı.'
                        ),
                        h3('Site ne yapıyor'),
                        ul(
                            'Sitenin hiçbir yerinde anahtar yok. Her işlem, testte de canlıda da kendi cüzdanınızla imzalanır.',
                            'Sayfanın ne yükleyebileceğine dair katı kurallar, site ve verisi için tek bir adres ve sunucunun ne sıklıkla çağrılabileceğine dair sınırlar.',
                            'Bilinmeyen tokenler siz işlem yapamadan etiketlenir, büyük fiyat hareketi bilerek onay gerektirir ve sınırsız izin asla varsayılan değildir.',
                            'Her şey açık kaynak; matematiğimizi asıl sözleşmelerle, sunucumuzu senaryolanmış bir zincirle ve sayfalarımızı taklit bir sunucuyla karşılaştıran testlerle birlikte.'
                        ),
                        callout('Denetimler hakkında dürüst bir söz', 'Uniswap kodu yıllar içinde defalarca denetlendi. Ama bunun Nura Chain üzerindeki bu kurulumu henüz dışarıdan bir firma tarafından baştan sona denetlenmedi. O denetim ikinci bölümdeki yol haritasında var. Yapılana kadar bu borsaya ne ise o gözle bakın: genç bir zincirdeki sözleşmelerde toplanmış para.'),
                        h3('Ortadan kalkmayan riskler'),
                        ul(
                            'Henüz kimsenin bulmadığı bir hata: sözleşmelerde, zincirde ya da bir cüzdanda.',
                            'Piyasa riski: yukarıda anlatılan püf nokta havuz besleyenler için, fiyat hareketi işlem yapanlar için ve genç bir piyasada işlemlerin azlığı.',
                            'Köprü riski: köprülenmiş bir token, gerçek parayı tutan köprü ne kadar sağlamsa o kadar sağlamdır.',
                            'Token riski: herkes token yaratıp ona istediği adı verebilir. Bir havuzun var olması, içindeki tokenin dürüst olduğu hakkında hiçbir şey söylemez.',
                            'Sıradan arızalar: sunucumuz ya da zincir bağlantısı geri kalabilir veya durabilir. İşlemler sürer, ama sayfadaki sayılar bayat olabilir.'
                        )
                    ]
                }
            ]
        },
        {
            id: 'business',
            label: 'İkinci bölüm',
            title: 'Plan',
            lede: 'Bu kimin için, masrafını nasıl çıkarıyor ve sırada ne var.',
            sections: [
                {
                    id: 'vision',
                    title: 'Ne yapmaya çalışıyoruz',
                    blocks: [
                        p('Varmak istediğimiz yer: Nura Chain’in kendi piyasası olsun. Zincirdeki her tokenin, herkes tarafından, her yerden, aracısız fiyatlanıp işlem görebildiği bir yer.'),
                        p('Nasıl varacağız: zincirin dayandığı borsayı kurup çalıştırarak. En güvenilir sözleşmeler, en iyi fiyat verisi ve insanların kendi dilinde okuyabildiği bir site; masrafı da küçük, görünür ve bizim değil sözleşmenin uyguladığı bir komisyonla karşılansın.'),
                        p('Nura Swap tesisat işidir. Üstüne başka şeyler kurulduğunda başarılı olur: onun üzerinden fiyat veren cüzdanlar, onun üzerinde başlayan yeni tokenler, fiyatlarını ondan okuyan uygulamalar.')
                    ]
                },
                {
                    id: 'market',
                    title: 'Bu kimin için',
                    blocks: [
                        p('Nura Chain, ekonomisinin hâlâ şekillendiği bir aşamada. Parasının sahipleri var, köprü BNB ve USDT’yi karşıya geçiriyor, projeler başladıkça daha çok token gelecek. Hepsinin önce aynı şeye ihtiyacı var: işlem yapacak bir yer. Bunu ilk sağlayan genelde elinde tutar; çünkü işlem parayı çeker, para işlemi çeker ve ikisi birlikte sonradan taşınması zahmetli olacak her şeyi çeker.'),
                        h3('Dört tür insan'),
                        table(
                            ['Kim', 'Neye ihtiyacı var', 'Burada ne buluyor'],
                            [
                                ['NURA tutanlar', 'Hiçbir yerde hesap açmadan NURA, dolar ve köprülenmiş paralar arasında gidip gelmenin bir yolu', 'Kendi cüzdanından, kendi dilinde, sözleşmenin uyguladığı sınırlarla takas'],
                                ['Boş duran tokeni olanlar', 'Öylece duran tokenlerden getiri, üstelik kontrolü kaybetmeden', 'Havuz beslemek, aralığı ve komisyon kademesini seçmek, kazancı istediği zaman almak'],
                                ['Nura Chain’deki yeni projeler', 'Kimseden izin almadan, ilk günden tokenine bir piyasa', 'Herkes her kademede havuz açabilir; otomatik olarak listelenir ve grafiği çıkar'],
                                ['Cüzdanlar ve diğer uygulamalar', 'Üzerine kurulacak fiyat ve takas', 'Herkese açık bir veri servisi, zincir üstünde bir fiyatlayıcı ve yönlendirici, ve kopyalayıp gömebilecekleri bir site']
                            ]
                        ),
                        h3('Neden burada ve neden şimdi'),
                        ul(
                            'Henüz kimse burada değil. Yerinden edilecek yerleşik bir borsa yok ve topluluk zaten sitenin çıktığı dilleri konuşuyor.',
                            'Köprü ön kapı. Nura Chain’e gelen BNB ve USDT’nin NURA ile buluşacağı bir yere ihtiyacı var; o yer burası.',
                            'Nura Wallet bu borsa için bir bağlayıcıyla geliyor; yani zincirin kendi cüzdanı kullanıcılarını doğrudan buraya getiriyor.'
                        )
                    ]
                },
                {
                    id: 'value',
                    title: 'Proje masrafını nasıl çıkarıyor',
                    blocks: [
                        p('Böyle bir borsa aynı anda üç yerde değer üretir. Boş duran tokeni olanlar ondan bir şey kazanır. İşlem yapanlar karşı tarafta birine ihtiyaç duymadan fiyat bulur. Ve bütün zincir, şeylerin ne ettiğine dair bir rakam kazanır. Nura Swap bunlardan ilkinden pay alır; hem de sözleşmelerin içine gömülü tek bir anahtarla.'),
                        h3('Protokol komisyonu'),
                        p('Uniswap tasarımı, fabrika sahibinin bir havuzda protokol komisyonunu açmasına izin verir: işlemin zaten ödediği komisyonun onda biri ile dörtte biri arası. Komisyonun üstüne eklenmez, içinden alınır; yani işlem yapan her hâlükârda tam olarak aynı parayı öder, o dilim sadece başka yere gider. Tahsil edilene kadar havuzun içinde, işlem gören tokenler cinsinden birikir. Bugün bütün havuzlarda kapalı.'),
                        p('Plan, borsa hâlâ likidite toplarken kapalı bırakmak, sonra yavaş yavaş açmak: önce en derin havuzlar, en küçük ayarla, hem de besleyenler doğru düzgün kazanmaya başladıktan ve önceden duyurduktan sonra. Her değişiklik bilinen bir adresten yapılan herkese açık bir işlemdir ve isteyen gezginde olup bitişini izleyebilir.'),
                        h3('Bu ne kadar eder'),
                        table(
                            ['Günlük işlem hacmi', 'Besleyenler kazanır', 'Projenin payı', 'Yılda'],
                            [
                                ['100.000 $ ise', '300 $', '60 $', '21.900 $'],
                                ['1.000.000 $ ise', '3.000 $', '600 $', '219.000 $'],
                                ['10.000.000 $ ise', '30.000 $', '6.000 $', '2.190.000 $']
                            ],
                            [0, 1, 2, 3]
                        ),
                        p('Bunlar %0,30 kademesinde beşte bir dilimle verilmiş örnekler, tahmin değil: gerçek rakam işlemin hangi havuzlarda döndüğüne bağlı. Önemli olan şekil. Gelir işlem hacmiyle büyür, besleyenlere kazandıklarının bir kısmına, işlem yapanlara ise hiçbir şeye mal olur ve çalışması için ne token, ne abonelik, ne de kimsenin mevduatı gerekir.'),
                        h3('Başka yollar'),
                        ul(
                            'Yeni projelerin düzgün başlamasına yardım etmek: komisyon kademesini seçmek, ilk havuzu kurmak, bir ödül kampanyası yürütmek; proje başına ücretlendirilir.',
                            'Fiyat verisini cüzdanlara ve panolara hizmet olarak sunmak; sunucunun kendisi ise kendi çalıştırmak isteyen herkese açık kalır.',
                            'Zincirin ihtiyaç duyduğu ve bu projenin kurmaya elverişli olduğu altyapı için Nura Chain’den hibeler: yönlendirme, fiyat akışları, analitik.'
                        ),
                        callout('Nura Swap tokeni diye bir şey yok', 'Bu projenin kendi tokeni yok ve gerek de duymuyor. İşlemleri NURA öder, komisyonlar neyle işlem yapıldıysa onunla gelir ve protokol komisyonu da aynı şekilde toplanır. Ne satış, ne ön satış, ne de planlanmış bir airdrop var. Bu bir gün değişirse projenin kendi kanallarından duyurulur; asla başkası tarafından ve asla özel mesajla değil.')
                    ]
                },
                {
                    id: 'go-to-market',
                    title: 'Nasıl büyütüyoruz',
                    blocks: [
                        steps(
                            { title: 'Başlatma - yapıldı', text: 'Borsa Nura Chain üzerinde canlı; WNURA, Bridge BNB ve Bridge USDT ile; sunucu ve verisi; on dilde site; Nura Wallet bağlayıcısı; 1.3.0 sürümü.' },
                            { title: 'İlk besleyenleri getirmek', text: 'İnsanlara Farsça ve İngilizce olarak aralığın gerçekte ne olduğunu ve bir pozisyonun nasıl okunacağını öğretmek; piyasanın üzerine kurulduğu iki havuz için Nura Chain ile ödüller üzerinde çalışmak: NURA’ya karşı USDT ve NURA’ya karşı BNB.' },
                            { title: 'Her yeni projeyle görüşmek', text: 'Nura Chain üzerinde token çıkaran her ekiple çıkmadan önce konuşmak: doğru komisyon kademesi, ilk havuz, daha ilk günden listeleme ve grafik.' },
                            { title: 'Diğer her şeyin içine girmek', text: 'Fiyatlayıcımızı ve verimizi cüzdanların, gezginlerin ve panoların önüne koymak; böylece bu borsanın fiyatı zincirin fiyatı, yönlendiricisi de takasın olağan yolu olsun.' },
                            { title: 'Büyümek', text: 'Havuzları derinleştirmek, köprü büyüdükçe token eklemek, protokol komisyonunu açmak ve onu yol haritasına harcamak.' }
                        ),
                        h3('İnsanlara nerede ulaşıyoruz'),
                        ul(
                            'Zincirin kendi mekânları: Nura Wallet, gezgin ve Telegram, Discord, X ile Instagram’daki Nura Chain topluluğu.',
                            'Dokümantasyon ve bu doküman, topluluğun gerçekten okuduğu dillerde.',
                            'Açık kaynak olmak başlı başına bir kanal: herkesin kopyalayabildiği bir site, bu borsanın üstüne bir şey kurmayı ucuzlatır.'
                        )
                    ]
                },
                {
                    id: 'roadmap',
                    title: 'Sırada ne var',
                    blocks: [
                        p('Bir yön, bir söz değil. İşler zincir ve topluluk kadar hızlı ilerler. Gerçekten yayımlanan şeyler, herkese açık olan değişiklik günlüğüne kaydedilir.'),
                        table(
                            ['Ne zaman', 'Ne'],
                            [
                                ['Yapıldı - 2026 3. çeyrek', 'Borsanın kendisi; takas, likidite ve portföy sayfaları; veri sunucusu; sağdan sola diller dâhil on dil; Nura Wallet bağlayıcısı; kurulabilir uygulama'],
                                ['2026 4. çeyrek', 'Bu kurulumun dışarıdan denetimi; daha iyi fiyat verdiğinde aynı anda iki havuz üzerinden işlem; havuz başına daha çok geçmiş ve getiri; bu dokümanın daha çok dilde yayımlanması'],
                                ['2027 ilk yarı', 'Protokol komisyonunun açılması ve bunun politikası; Nura Chain ile bir ödül programı; aralıkların basit limit emri olarak kullanılması; pozisyon yönetimi için daha iyi araçlar; köprü ekledikçe daha çok köprülenmiş token'],
                                ['2027 ikinci yarı', 'Cüzdan ve uygulamaların üstüne kurabileceği bir araç seti; sahip anahtarının, imzacıları açıklanmış çok imzalı bir hesabın arkasına alınması; havuz fiyatlarının, Nura Chain’deki diğer uygulamaların dayanabileceği bir akış olarak sunulması']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'governance',
                    title: 'Kim neyi değiştirebilir',
                    blocks: [
                        p('Sözleşmeler değiştirilemediği için yönetilecek pek bir şey kalmıyor. Tek bir anahtarın, fabrika sahibinin, tam olarak iki yetkisi var: yeni bir komisyon kademesi eklemek ve bir havuzda protokol komisyonunu açmak. Bir havuzu durduramaz, para alamaz, var olan bir komisyon kademesini değiştiremez, kimsenin pozisyonuna dokunamaz. Her iki yetki de zincir üzerinde, herkesin gördüğü yerde, açıkça kullanılır.'),
                        facts(
                            { label: 'Sahip anahtarı', value: '0x4ac0d9300422b408bA2AbF47995C87cF32763712', mono: true },
                            { label: 'Yapabilir', value: 'Komisyon kademesi eklemek; bir havuzda protokol komisyonunu açmak' },
                            { label: 'Yapamaz', value: 'Hiçbir şeyi durdurmak, kodu değiştirmek ya da tek bir tokeni kımıldatmak' }
                        ),
                        p('Site ve sunucu, değişiklik günlüğüyle birlikte herkese açık depodan yayımlanır ve her sürüm yayına çıkmadan önce aynı denetimlerden geçmek zorundadır. Sunucu sağlıklı olup olmadığını ve ne kadar güncel olduğunu bildirir, böylece sorunlar çabuk görünür. Destek ve duyurular bu dokümanın sonunda listelenen kanallardan geçer, başka hiçbir yerden değil.')
                    ]
                },
                {
                    id: 'metrics',
                    title: 'İşe yarayıp yaramadığını nasıl anlarsınız',
                    blocks: [
                        p('Bunların hiçbirinde bize inanmak zorunda değilsiniz. Ana sayfa havuzlardaki parayı, son bir günün işlem hacmini ve havuz sayısını canlı gösterir. Aşağıdaki her rakam aynı herkese açık veriden gelir ve isteyen okuyabilir.'),
                        table(
                            ['Neyi izliyoruz', 'Neden önemli'],
                            [
                                ['Havuzlardaki para', 'Piyasanın sendelemeden kaldırabileceği işlem büyüklüğü'],
                                ['Son 24 saatteki işlem', 'Ne kadar hareketli olduğu ve gelecekteki bir komisyonun neyle büyüyeceği'],
                                ['Listelenen havuz ve token sayısı', 'Zincirin ne kadarının gerçekten işlem görebilir olduğu'],
                                ['Besleyenler ve kaçının aralık içinde olduğu', 'Havuzları finanse edenlerin durumunun iyi olup olmadığı'],
                                ['Besleyenlerin kazancı', 'Havuz beslemenin değip değmediği'],
                                ['Üstüne kurulan cüzdan ve uygulamalar', 'Borsanın mobilyanın parçası hâline gelip gelmediği']
                            ]
                        )
                    ]
                },
                {
                    id: 'risks',
                    title: 'Planda ne ters gidebilir',
                    blocks: [
                        ul(
                            'Yavaş büyüme. Bir zincirin ekonomisi herkesin umduğundan uzun sürede oluşabilir ve hiç olmayan işlemden gelir de olmaz.',
                            'Rekabet. Herkes bu kodu kopyalayıp bir rakip açabilir. Savunma derinlik, entegrasyon ve güvendir; gizlilik değil, zaten açık kaynak ona izin vermiyor.',
                            'Köprü. Dışarıdan gelen ilk değer onun üzerinden geliyor; yani köprüdeki bir sıkıntı, onun üzerinden fiyatlanan tokenler için de sıkıntıdır.',
                            'Düzenleme. Bu tür borsalara dair kurallar ülkeden ülkeye değişiyor ve sürekli değişmeye devam ediyor. Projenin nasıl işlediğini uyarlayabiliriz; sözleşmeleri uyarlayamayız, çünkü kimse uyarlayamaz.',
                            'Anahtar. Sahip anahtarı çok imzalı bir hesabın arkasına alınana kadar, onu çalan biri protokol komisyonunu açabilir. Yine de tek bir tokeni bile kımıldatamaz.',
                            'Güvenlik. Sözleşmelerde, zincirde ya da bir cüzdanda keşfedilmemiş bir hata insanlara paraya mal olabilir. Yol haritasındaki denetim bu riski azaltır. Hiçbir şey ortadan kaldırmaz.'
                        )
                    ]
                },
                {
                    id: 'contracts',
                    title: 'Ek A: Adresler',
                    blocks: [
                        p('Şu anda Nura Chain üzerinde canlı olanlar bunlar; daha önce anlatılan dosyadan alındı. Bunlardan biriyle doğrudan etkileşime girecekseniz önce gezginden kontrol edin.'),
                        table(
                            ['Nedir', 'Adres'],
                            [
                                ['Fabrika - havuzları yaratır', '0x88E8bB62E1654e695043FD5416D5E5415AFFd39b'],
                                ['Yönlendirici - takasları yapar', '0x98b52fB699F1F91494b2937fECf109f8E09570Ae'],
                                ['Fiyatlayıcı - «ne alırım?» sorusuna cevap verir', '0x4b6f7C7d1337F6C6A624677688EA8035c3Ed6782'],
                                ['Pozisyon yöneticisi - makbuzlarınız', '0xcf00BFaA3c292205D38d37f9086c4F3838339Fbb'],
                                ['Tick lens - merdiveni okur', '0xbFdA09e0D89ABa201491F81dcD0993Fd223e66A0'],
                                ['WNURA - token hâlindeki NURA', '0xf0a4eC07916feBa4432121Ed5969887D9b939cD0'],
                                ['Multicall - tek seferde çok soru', '0xf58884FCf45d8F5Cc8A73c618D23EB27b732CA24'],
                                ['Bridge BNB', '0xD4221Ad9772BF5bA7423a044bBBEe6af2154A5Fc'],
                                ['Bridge USDT', '0x4E0DB0B1Da408faF5637202CF48b0bc7733bE6dC'],
                                ['Sahip anahtarı', '0x4ac0d9300422b408bA2AbF47995C87cF32763712']
                            ],
                            [1]
                        ),
                        facts(
                            { label: 'Zincir kimliği', value: '1020', mono: true },
                            { label: 'Kurulduğu blok', value: '124110', mono: true },
                            { label: 'Ondalık basamak', value: '18 - listelenen her tokende', mono: true }
                        )
                    ]
                },
                {
                    id: 'glossary',
                    title: 'Ek B: Bu dokümanda geçen kelimeler',
                    blocks: [
                        table(
                            ['Kelime', 'Ne demek'],
                            [
                                ['AMM', 'Otomatik piyasa yapıcı: alıcıyla satıcıyı eşleştirmek yerine, elindekine bakarak fiyat veren bir sözleşme.'],
                                ['Havuz', 'Tek bir komisyon kademesinde iki tokeni tutan tek bir sözleşme. Bir token çiftinin dört taneye kadar havuzu olabilir.'],
                                ['Komisyon kademesi', 'Bir havuzun her işlemden aldığı pay: %0,01, %0,05, %0,30 ya da %1,00.'],
                                ['Tick', 'Fiyat merdiveninin bir basamağı. Her basamak bir altındakinden %0,01 yukarıdadır.'],
                                ['Tick aralığı', 'Bir komisyon kademesinin, aralığın uçlarını kaç basamak arayla koymanıza izin verdiği: 1, 10, 60 ya da 200.'],
                                ['sqrtPriceX96', 'Havuzun fiyatı; karekök olarak tutulur ve hiçbir şey yuvarlanmasın diye tam sayı olarak saklanır.'],
                                ['Likidite (L)', 'Fiyatın arkasında ne kadar para olduğu - havuzun bulunduğu basamaktaki derinliği.'],
                                ['Pozisyon', 'Havuz beslediğinize dair makbuzunuz: hangi havuz, hangi aralık, ne kadar.'],
                                ['Aralık içinde', 'Fiyat aralığınızın iki ucu arasında; yani iki tokene de sahipsiniz ve komisyon kazanıyorsunuz.'],
                                ['Fiyat etkisi', 'Kendi işleminizin fiyatı ne kadar ittiği, komisyondan önce.'],
                                ['Kayma toleransı', 'Kabul etmeye razı olduğunuz en kötü fiyat. Onu geçerse sözleşme işlemi iptal eder.'],
                                ['Son tarih', 'Ondan sonra sözleşmenin işleminizi hiç çalıştırmayı reddettiği an.'],
                                ['Fiyatlayıcı', 'Takas yapıyormuş gibi yapıp ne alacağınızı bildiren, ama gerçekte yapmayan bir sözleşme.'],
                                ['Yönlendirici', 'Takasları gerçekleştiren, gerektiğinde NURA’yı sarmalayıp açan sözleşme.'],
                                ['Pozisyon yöneticisi', 'Pozisyonları çıkaran, değiştiren ve kapatan, komisyonlarını ödeyen sözleşme.'],
                                ['WNURA', 'Token hâlindeki NURA, bire bir çevrilebilir; çünkü havuzlar yalnızca token tutabilir.'],
                                ['Protokol komisyonu', 'Fabrika sahibinin projeye yönlendirebileceği, işlem komisyonundan isteğe bağlı bir dilim.'],
                                ['Geçici kayıp', 'İki tokeni öylece tutup hiçbir şey yapmamaya kıyasla daha az parayla kalmak.'],
                                ['TVL', 'Toplam kilitli değer: havuzlardaki her şeyin değeri, yalnızca çıpalayabildiğimiz fiyatlar sayılarak.'],
                                ['İndeksleyici', 'Sunucumuz: sözleşmeleri takip eder ve sitenin gösterdiği geçmişi tutar.']
                            ],
                            [0]
                        )
                    ]
                },
                {
                    id: 'links',
                    title: 'Ek C: Bizi nerede bulursunuz',
                    blocks: [
                        table(
                            ['Ne', 'Nerede'],
                            [
                                ['Kaynak kod - site, sunucu ve matematik', 'https://github.com/NuraChain/Swap'],
                                ['Nura Chain bağlantı noktası', 'https://rpc.nurachain.net'],
                                ['Blok gezgini', 'https://explorer.nurachain.net'],
                                ['X', 'https://x.com/nurachainnet'],
                                ['Discord', 'https://discord.gg/8BMAXTdXQg'],
                                ['Telegram', 'https://t.me/nurachain'],
                                ['Instagram', 'https://www.instagram.com/nura.chain/']
                            ],
                            [1]
                        ),
                        ol(
                            'Adams, Zinsmeister, Salem, Keefer, Robinson - Uniswap v3 Core (2021). Bu borsanın matematiğinin geldiği makale.',
                            'Nura Swap deposu - burada anlatılan sistem parçaları için README, CHANGELOG ve TESTING dosyaları.'
                        )
                    ]
                }
            ]
        }
    ]
};
