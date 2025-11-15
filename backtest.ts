import axios from "axios";

// ===================== TIPI =====================
type Position = {
    type: "LONG" | "SHORT";
    entry: number;
};

type Trade = {
    type: "LONG" | "SHORT";
    entry: number;
    exit: number;
    pnl: number;
};

// ===================== PARAMETRI =====================
const CAPITAL = 1000;
const LEVERAGE = 5;
const MA_FAST = 10;
const MA_SLOW = 20;
const RSI_PERIOD = 14;
const TP_PERCENT = 1;   // % Take Profit
const SL_PERCENT = 0.5; // % Stop Loss
const SYMBOL = "ETHUSDT";
const INTERVAL = "1"; // 1 minuto
const LIMIT = 2000;    // numero di candele da scaricare

// ===================== FUNZIONI =====================
function sma(data: number[], period: number): number {
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(data: number[], period: number): number {
    let gains = 0;
    let losses = 0;
    for (let i = data.length - period; i < data.length - 1; i++) {
        const change = data[i + 1] - data[i];
        if (change > 0) gains += change;
        else losses -= change;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
}

function getResistance(data: number[], period: number): number {
    return Math.max(...data.slice(-period));
}

function getSupport(data: number[], period: number): number {
    return Math.min(...data.slice(-period));
}

// ===================== BACKTEST =====================
async function runBacktest() {
    // Scarica dati da Bybit
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}`;
    const response = await axios.get(url);
    const candles = response.data.result.list.map((c: any) => parseFloat(c[4]));
    const highs = response.data.result.list.map((c: any) => parseFloat(c[2]));
    const lows = response.data.result.list.map((c: any) => parseFloat(c[3]));

    let equity = CAPITAL;
    let openPos: Position | null = null;
    const trades: Trade[] = [];

    for (let i = MA_SLOW; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);

        const maFastPrev = sma(slice.slice(0, -1), MA_FAST);
        const maSlowPrev = sma(slice.slice(0, -1), MA_SLOW);

        const maFast = sma(slice, MA_FAST);
        const maSlow = sma(slice, MA_SLOW);
        const currentRSI = rsi(slice, RSI_PERIOD);
        const currentPrice = slice[slice.length - 1];

        const resistance = getResistance(highs.slice(0, i + 1), 20);
        const support    = getSupport(lows.slice(0, i + 1), 20);

        const maDiffPercent = ((maFast - maSlow) / maSlow) * 100;

        // Controllo crossover
        const crossedUp = maFastPrev < maSlowPrev && maFast > maSlow;
        const crossedDown = maFastPrev > maSlowPrev && maFast < maSlow;

        let action: "LONG" | "SHORT" | null = null;

        if (crossedUp && currentRSI < 55 && currentPrice < resistance) action = "LONG";
        else if (crossedDown && currentRSI > 45 && currentPrice > support) action = "SHORT";

        // Gestione posizione aperta
        if (openPos) {
            if (openPos.type === "LONG") {
                const tp = openPos.entry * (1 + TP_PERCENT / 100);
                const sl = openPos.entry * (1 - SL_PERCENT / 100);
                if (currentPrice >= tp || currentPrice <= sl) {
                    const pnl = ((currentPrice - openPos.entry) / openPos.entry) * LEVERAGE * CAPITAL;
                    equity += pnl;
                    trades.push({ type: "LONG", entry: openPos.entry, exit: currentPrice, pnl });
                    openPos = null;
                }
            } else if (openPos.type === "SHORT") {
                const tp = openPos.entry * (1 - TP_PERCENT / 100);
                const sl = openPos.entry * (1 + SL_PERCENT / 100);
                if (currentPrice <= tp || currentPrice >= sl) {
                    const pnl = ((openPos.entry - currentPrice) / openPos.entry) * LEVERAGE * CAPITAL;
                    equity += pnl;
                    trades.push({ type: "SHORT", entry: openPos.entry, exit: currentPrice, pnl });
                    openPos = null;
                }
            }
        }

        // Apri nuova posizione se non ce n'è una
        if (!openPos && action) {
            openPos = { type: action, entry: currentPrice };
        }
    }

    // ===================== REPORT =====================
    const totalPnL = equity - CAPITAL;
    console.log("=== BACKTEST COMPLETO ===");
    console.log("Capitale iniziale:", CAPITAL);
    console.log("Capitale finale:", equity.toFixed(2));
    console.log("Profit/Loss totale:", totalPnL.toFixed(2));
    console.log("Numero trade:", trades.length);
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = trades.filter(t => t.pnl <= 0).length;
    console.log("Vinti:", wins, "Persi:", losses);
}

runBacktest().catch(err => console.error(err));
