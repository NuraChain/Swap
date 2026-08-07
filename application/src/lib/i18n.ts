// The app's two languages as one typed dictionary: a missing Persian key is a
// compile error, not a silent English fallback. Reading t() inside a component
// tracks the language signal, so a toggle re-renders every string in place.
// SSR renders the 'en' default; the persisted choice applies on hydration.

import { createSignal } from 'azerothjs';

export type Lang = 'en' | 'fa';

const STORAGE_KEY = 'nuraswap.lang';
const [langSignal, setLangSignal] = createSignal<Lang>('en');
let initialized = false;

function initFromStorage(): void
{
    if (initialized || typeof window === 'undefined')
    {
        return;
    }
    initialized = true;
    const stored = readStorage(STORAGE_KEY);
    if (stored === 'fa' || stored === 'en')
    {
        applyLang(stored);
    }
}

// Storage can be absent or throwing (privacy modes, test DOMs) - degrade to the
// default rather than taking the app down.
function readStorage(key: string): string | null
{
    try
    {
        return window.localStorage.getItem(key);
    }
    catch
    {
        return null;
    }
}

function applyLang(lang: Lang): void
{
    setLangSignal(lang);
    if (typeof document !== 'undefined')
    {
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    }
}

export function currentLang(): Lang
{
    initFromStorage();
    return langSignal();
}

export function setLang(lang: Lang): void
{
    applyLang(lang);
    try
    {
        window.localStorage.setItem(STORAGE_KEY, lang);
    }
    catch
    {
        // Preference lives for the session only.
    }
}

const en = {
    nav:
    {
        swap: 'Swap',
        liquidity: 'Liquidity',
        portfolio: 'Portfolio',
        home: 'NuraSwap'
    },
    common:
    {
        connect: 'Connect wallet',
        disconnect: 'Disconnect',
        copy: 'Copy address',
        copied: 'Copied',
        close: 'Close',
        cancel: 'Cancel',
        confirm: 'Confirm',
        max: 'Max',
        all: 'All',
        balance: 'Balance',
        loading: 'Loading',
        retry: 'Retry',
        settings: 'Settings',
        search: 'Search',
        theme: 'Switch theme',
        language: 'Switch language',
        viewExplorer: 'View on explorer',
        indexerLag: 'Market data is catching up - pools, charts and history may lag the chain by a few blocks. Quotes and balances are read live and stay correct.',
        firstPage: 'First page',
        previousPage: 'Previous page',
        nextPage: 'Next page',
        lastPage: 'Last page',
        page: 'Page',
        showing: 'Showing',
        of: 'of',
        notFound: 'This page does not exist.',
        goSwap: 'Go to swap'
    },
    landing:
    {
        headline: 'Trade straight from your wallet.',
        sub: 'NuraSwap is an automated market maker: every swap settles on-chain against open liquidity pools. No account, no custody - your keys stay yours.',
        cta: 'Start swapping',
        ctaPools: 'Explore pools',
        statTvl: 'Value locked',
        statVolume: '24h volume',
        statPools: 'Pools',
        featureSwapTitle: 'Swaps without an order book',
        featureSwapBody: 'Prices come from the constant-product formula over pooled reserves. Quotes update as the pool moves, and your slippage limit is enforced by the contract, not by trust.',
        featureEarnTitle: 'Provide liquidity, earn the fee',
        featureEarnBody: 'Every trade pays 0.30% to its pool. Deposit two tokens, receive LP tokens, and your share of every trade accrues to your position until you withdraw.',
        featureCustodyTitle: 'Self-custody, end to end',
        featureCustodyBody: 'The exchange is a set of audited immutable contracts. This site is a window onto them - it never holds funds, keys, or sessions.',
        howTitle: 'How a swap settles',
        how1Title: 'Connect',
        how1Body: 'Any injected wallet works. The site reads balances and quotes; nothing moves without your signature.',
        how2Title: 'Quote',
        how2Body: 'The router computes your output from live reserves, shows the price impact, and holds your minimum as a hard bound.',
        how3Title: 'Settle',
        how3Body: 'One transaction swaps against the pool. If the price slips past your limit, the contract reverts and nothing is spent but gas.',
        liveTitle: 'Live on-chain',
        builtWith: 'Built with AzerothJS'
    },
    footer:
    {
        tagline: 'An open automated market maker. Your keys, your trades.',
        product: 'Product',
        resources: 'Resources',
        source: 'Source code',
        framework: 'AzerothJS',
        rights: 'NuraSwap. The contracts are immutable; this site is one window onto them.'
    },
    wallet:
    {
        connectTitle: 'Connect a wallet',
        noWallets: 'No wallet detected yet. Install one of these, then reload this page.',
        detected: 'Detected',
        installLabel: 'Install',
        otherDetected: 'Also detected',
        moreWallets: 'Any browser wallet works - these are the ones we can name.',
        wrongNetwork: 'Wrong network',
        switchNetwork: 'Switch network',
        connectedVia: 'Connected via',
        pending: 'Pending',
        confirmed: 'Confirmed',
        failed: 'Failed'
    },
    swap:
    {
        title: 'Swap',
        from: 'You pay',
        to: 'You receive',
        selectToken: 'Select a token',
        enterAmount: 'Enter an amount',
        insufficient: 'Insufficient balance',
        approve: 'Approve',
        approving: 'Approving',
        swapAction: 'Swap',
        switchDirection: 'Switch direction',
        swapping: 'Swapping',
        wrap: 'Wrap',
        unwrap: 'Unwrap',
        rate: 'Rate',
        priceImpact: 'Price impact',
        minReceived: 'Minimum received',
        fee: 'Liquidity fee',
        slippage: 'Slippage tolerance',
        auto: 'Auto',
        deadline: 'Transaction deadline',
        minutes: 'minutes',
        noRoute: 'No pool for this pair yet',
        beFirstLp: 'Create it on the liquidity page and set the first price.',
        highImpact: 'Price impact is above 15%. This trade moves the pool hard - you will get a much worse rate. Type the amount again only if you are sure.',
        confirmHighImpact: 'Swap anyway',
        recentTrades: 'Recent trades',
        chartEmpty: 'No trades charted yet',
        importToken: 'Import token by address',
        unknownToken: 'Unknown token - anyone can deploy a token with any name. Verify the address before trading.',
        importAction: 'Import',
        pasteAddress: 'Paste a token address',
        infiniteApprove: 'Unlimited approval',
        infiniteApproveHint: 'Approve once for all future swaps of this token. Cheaper long-run, but the router keeps the allowance until you revoke it.',
        slippageHint: 'Your transaction reverts if the price moves against you by more than this.',
        impactHint: 'How far this trade itself moves the pool price, fee excluded.',
        deadlineHint: 'The transaction reverts if it does not confirm within this window.'
    },
    liquidity:
    {
        title: 'Liquidity',
        pools: 'Pools',
        myPositions: 'My positions',
        add: 'Add liquidity',
        remove: 'Remove',
        tvl: 'TVL',
        volume: '24h volume',
        apr: 'Fee APR',
        price: 'Price',
        share: 'Pool share',
        pooled: 'Pooled',
        lpTokens: 'LP tokens',
        searchPools: 'Search pools',
        noPools: 'No pools yet.',
        noPositions: 'No positions. Add liquidity to a pool to start earning the trading fee.',
        connectFirst: 'Connect a wallet to see your positions.',
        firstProvider: 'This pool is empty. Your deposit sets the opening price - make sure the ratio matches the market, or arbitrage will take the difference.',
        amountA: 'First token',
        amountB: 'Second token',
        approveBoth: 'Both tokens need approval before the deposit.',
        confirmAdd: 'Confirm deposit',
        confirmRemove: 'Confirm withdrawal',
        removeAmount: 'Amount to withdraw',
        receiveEstimate: 'You receive (estimate)',
        newPool: 'New pool',
        selectPair: 'Select the pair',
        unpriced: 'Unpriced'
    },
    portfolio:
    {
        title: 'Portfolio',
        holdings: 'Holdings',
        totalValue: 'Total value',
        asset: 'Asset',
        amount: 'Amount',
        price: 'Price',
        value: 'Value',
        history: 'Your activity',
        noHistory: 'No activity yet. Your swaps and liquidity moves land here.',
        noHoldings: 'No balances yet. Swap into a token or use the faucet on a test chain.',
        faucet: 'Get test tokens',
        faucetHint: 'Sends you some of each mock token to trade with. Test chains only - these carry no real value.',
        faucetDone: 'Test tokens received'
    },
    errors:
    {
        rejected: 'You declined the signature. Nothing was sent.',
        expired: 'The deadline passed before the transaction confirmed. Nothing was spent - try again.',
        insufficientOutput: 'The price moved past your slippage limit and the contract reverted. Raise the limit or trade a smaller amount.',
        transferFailed: 'A token transfer failed. Check the balance and allowance for this token.',
        insufficientLiquidity: 'The pool is too shallow for this trade.',
        wrongNetwork: 'Your wallet is on a different network. Switch to the one this exchange is deployed on, then try again.',
        unknown: 'The transaction failed on-chain. Nothing beyond gas was spent.'
    }
};

const fa: typeof en = {
    nav:
    {
        swap: 'مبادله',
        liquidity: 'نقدینگی',
        portfolio: 'دارایی‌ها',
        home: 'نوراسواپ'
    },
    common:
    {
        connect: 'اتصال کیف پول',
        disconnect: 'قطع اتصال',
        copy: 'کپی نشانی',
        copied: 'کپی شد',
        close: 'بستن',
        cancel: 'انصراف',
        confirm: 'تأیید',
        max: 'حداکثر',
        all: 'همه',
        balance: 'موجودی',
        loading: 'در حال بارگذاری',
        retry: 'تلاش دوباره',
        settings: 'تنظیمات',
        search: 'جستجو',
        theme: 'تغییر پوسته',
        language: 'تغییر زبان',
        viewExplorer: 'مشاهده در کاوشگر',
        indexerLag: 'داده‌های بازار در حال هماهنگ‌شدن است - استخرها، نمودارها و تاریخچه ممکن است چند بلاک از زنجیره عقب باشند. مظنه‌ها و موجودی‌ها زنده خوانده می‌شوند و درست می‌مانند.',
        firstPage: 'صفحه نخست',
        previousPage: 'صفحه قبل',
        nextPage: 'صفحه بعد',
        lastPage: 'صفحه آخر',
        page: 'صفحه',
        showing: 'نمایش',
        of: 'از',
        notFound: 'چنین صفحه‌ای وجود ندارد.',
        goSwap: 'رفتن به مبادله'
    },
    landing:
    {
        headline: 'مبادله، مستقیم از کیف پول شما.',
        sub: 'نوراسواپ یک بازارساز خودکار است: هر مبادله روی زنجیره و در برابر استخرهای نقدینگی باز تسویه می‌شود. بدون حساب کاربری و بدون امانت‌سپاری - کلیدها نزد خودتان می‌ماند.',
        cta: 'شروع مبادله',
        ctaPools: 'مشاهده استخرها',
        statTvl: 'ارزش قفل‌شده',
        statVolume: 'حجم ۲۴ ساعته',
        statPools: 'استخرها',
        featureSwapTitle: 'مبادله بدون دفتر سفارش',
        featureSwapBody: 'قیمت از فرمول حاصل‌ضرب ثابت روی ذخایر استخر به دست می‌آید. مظنه با حرکت استخر به‌روز می‌شود و حد لغزش شما را قرارداد تضمین می‌کند، نه اعتماد.',
        featureEarnTitle: 'نقدینگی بدهید، کارمزد بگیرید',
        featureEarnBody: 'هر معامله ۰٫۳۰٪ به استخر خودش می‌پردازد. دو توکن واریز کنید، توکن LP بگیرید و سهم شما از هر معامله تا زمان برداشت روی موقعیتتان انباشته می‌شود.',
        featureCustodyTitle: 'امانت‌داری شخصی، سرتاسری',
        featureCustodyBody: 'این صرافی مجموعه‌ای از قراردادهای تغییرناپذیر و حسابرسی‌شده است. این سایت فقط پنجره‌ای به آن‌هاست - هرگز وجه، کلید یا نشستی نگه نمی‌دارد.',
        howTitle: 'یک مبادله چگونه تسویه می‌شود',
        how1Title: 'اتصال',
        how1Body: 'هر کیف پول تزریقی کار می‌کند. سایت فقط موجودی و مظنه می‌خواند؛ بدون امضای شما چیزی جابه‌جا نمی‌شود.',
        how2Title: 'مظنه',
        how2Body: 'روتر خروجی شما را از ذخایر لحظه‌ای محاسبه می‌کند، اثر قیمتی را نشان می‌دهد و حداقل دریافتی را به‌عنوان حد سخت نگه می‌دارد.',
        how3Title: 'تسویه',
        how3Body: 'یک تراکنش در برابر استخر مبادله می‌کند. اگر قیمت از حد شما بگذرد، قرارداد برمی‌گردد و جز کارمزد شبکه چیزی خرج نمی‌شود.',
        liveTitle: 'زنده روی زنجیره',
        builtWith: 'ساخته‌شده با AzerothJS'
    },
    footer:
    {
        tagline: 'یک بازارساز خودکار متن‌باز. کلیدها و معامله‌ها از آنِ شما.',
        product: 'محصول',
        resources: 'منابع',
        source: 'کد منبع',
        framework: 'AzerothJS',
        rights: 'نوراسواپ. قراردادها تغییرناپذیرند؛ این سایت تنها پنجره‌ای به آن‌هاست.'
    },
    wallet:
    {
        connectTitle: 'اتصال کیف پول',
        noWallets: 'هنوز کیف پولی شناسایی نشد. یکی از این‌ها را نصب کنید و صفحه را دوباره بارگذاری کنید.',
        detected: 'شناسایی شد',
        installLabel: 'نصب',
        otherDetected: 'موارد شناسایی‌شده دیگر',
        moreWallets: 'هر کیف پول مرورگری کار می‌کند - این‌ها مواردی هستند که می‌شناسیم.',
        wrongNetwork: 'شبکه نادرست',
        switchNetwork: 'تغییر شبکه',
        connectedVia: 'متصل از طریق',
        pending: 'در انتظار',
        confirmed: 'تأیید شد',
        failed: 'ناموفق'
    },
    swap:
    {
        title: 'مبادله',
        from: 'می‌پردازید',
        to: 'دریافت می‌کنید',
        selectToken: 'انتخاب توکن',
        enterAmount: 'مقدار را وارد کنید',
        insufficient: 'موجودی کافی نیست',
        approve: 'مجوز',
        approving: 'در حال صدور مجوز',
        swapAction: 'مبادله',
        switchDirection: 'جابه‌جایی جهت',
        swapping: 'در حال مبادله',
        wrap: 'تبدیل به رپد',
        unwrap: 'بازکردن رپد',
        rate: 'نرخ',
        priceImpact: 'اثر قیمتی',
        minReceived: 'حداقل دریافتی',
        fee: 'کارمزد نقدینگی',
        slippage: 'حد لغزش قیمت',
        auto: 'خودکار',
        deadline: 'مهلت تراکنش',
        minutes: 'دقیقه',
        noRoute: 'هنوز استخری برای این جفت نیست',
        beFirstLp: 'در صفحه نقدینگی آن را بسازید و قیمت نخست را تعیین کنید.',
        highImpact: 'اثر قیمتی بالای ۱۵٪ است. این معامله استخر را به‌شدت جابه‌جا می‌کند و نرخ بسیار بدتری می‌گیرید. فقط اگر مطمئن هستید ادامه دهید.',
        confirmHighImpact: 'به هر حال مبادله کن',
        recentTrades: 'معاملات اخیر',
        chartEmpty: 'هنوز معامله‌ای ثبت نشده',
        importToken: 'افزودن توکن با نشانی',
        unknownToken: 'توکن ناشناس - هر کسی می‌تواند توکنی با هر نامی منتشر کند. پیش از معامله نشانی را راستی‌آزمایی کنید.',
        importAction: 'افزودن',
        pasteAddress: 'نشانی توکن را وارد کنید',
        infiniteApprove: 'مجوز نامحدود',
        infiniteApproveHint: 'یک بار برای همه مبادله‌های آینده این توکن مجوز بدهید. در بلندمدت ارزان‌تر است، اما روتر تا زمان لغو، مجوز را نگه می‌دارد.',
        slippageHint: 'اگر قیمت بیش از این مقدار به زیان شما حرکت کند، تراکنش برمی‌گردد.',
        impactHint: 'میزان جابه‌جایی قیمت استخر توسط خود این معامله، بدون احتساب کارمزد.',
        deadlineHint: 'اگر تراکنش در این بازه تأیید نشود، برمی‌گردد.'
    },
    liquidity:
    {
        title: 'نقدینگی',
        pools: 'استخرها',
        myPositions: 'موقعیت‌های من',
        add: 'افزودن نقدینگی',
        remove: 'برداشت',
        tvl: 'ارزش قفل‌شده',
        volume: 'حجم ۲۴ ساعته',
        apr: 'سود سالانه کارمزد',
        price: 'قیمت',
        share: 'سهم از استخر',
        pooled: 'سپرده‌شده',
        lpTokens: 'توکن LP',
        searchPools: 'جستجوی استخرها',
        noPools: 'هنوز استخری نیست.',
        noPositions: 'موقعیتی ندارید. برای دریافت کارمزد معاملات، به یک استخر نقدینگی اضافه کنید.',
        connectFirst: 'برای دیدن موقعیت‌ها کیف پول را متصل کنید.',
        firstProvider: 'این استخر خالی است. سپرده شما قیمت آغازین را تعیین می‌کند - نسبت را با بازار هماهنگ کنید، وگرنه آربیتراژ تفاوت را برمی‌دارد.',
        amountA: 'توکن نخست',
        amountB: 'توکن دوم',
        approveBoth: 'پیش از واریز، هر دو توکن به مجوز نیاز دارند.',
        confirmAdd: 'تأیید واریز',
        confirmRemove: 'تأیید برداشت',
        removeAmount: 'مقدار برداشت',
        receiveEstimate: 'دریافتی شما (برآورد)',
        newPool: 'استخر جدید',
        selectPair: 'انتخاب جفت',
        unpriced: 'بدون قیمت'
    },
    portfolio:
    {
        title: 'دارایی‌ها',
        holdings: 'موجودی‌ها',
        totalValue: 'ارزش کل',
        asset: 'دارایی',
        amount: 'مقدار',
        price: 'قیمت',
        value: 'ارزش',
        history: 'فعالیت شما',
        noHistory: 'هنوز فعالیتی نیست. مبادله‌ها و حرکت‌های نقدینگی شما اینجا می‌نشیند.',
        noHoldings: 'هنوز موجودی‌ای نیست. توکنی مبادله کنید یا در زنجیره آزمایشی از شیر توکن استفاده کنید.',
        faucet: 'دریافت توکن آزمایشی',
        faucetHint: 'مقداری از هر توکن ساختگی برای آزمایش به کیف پول شما واریز می‌شود. فقط روی زنجیره آزمایشی کار می‌کند و ارزش واقعی ندارد.',
        faucetDone: 'توکن‌های آزمایشی واریز شد'
    },
    errors:
    {
        rejected: 'امضا را رد کردید. چیزی ارسال نشد.',
        expired: 'مهلت پیش از تأیید تراکنش گذشت. چیزی خرج نشد - دوباره تلاش کنید.',
        insufficientOutput: 'قیمت از حد لغزش شما گذشت و قرارداد بازگشت. حد را بالاتر ببرید یا مقدار کمتری معامله کنید.',
        transferFailed: 'انتقال توکن ناموفق بود. موجودی و مجوز این توکن را بررسی کنید.',
        insufficientLiquidity: 'عمق استخر برای این معامله کافی نیست.',
        wrongNetwork: 'کیف پول شما روی شبکه دیگری است. به شبکه‌ای که این صرافی روی آن مستقر است سوییچ کنید و دوباره تلاش کنید.',
        unknown: 'تراکنش روی زنجیره ناموفق بود. جز کارمزد شبکه چیزی خرج نشد.'
    }
};

const DICTS: Record<Lang, typeof en> = { en, fa };

export type Dict = typeof en;

export function t(): Dict
{
    return DICTS[currentLang()];
}

// Localized display formatting. Persian gets Persian digits and separators in
// DISPLAY only - inputs normalize back to ASCII before parsing (shared/digits).
export function fmtNumber(value: number, maxFractionDigits = 2): string
{
    return new Intl.NumberFormat(currentLang() === 'fa' ? 'fa-IR' : 'en-US', {
        maximumFractionDigits: maxFractionDigits
    }).format(value);
}

export function fmtUsd(value: number): string
{
    const text = fmtNumber(value, value >= 1000 ? 0 : 2);
    return currentLang() === 'fa' ? `${ text } دلار` : `$${ text }`;
}
