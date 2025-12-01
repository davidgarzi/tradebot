import _http from "http";
import _url, { pathToFileURL } from "url";
import _fs from "fs";
import _express from "express";
import _dotenv from "dotenv";
import _cors from "cors";
import _fileUpload from "express-fileupload";
import _streamifier from "streamifier";
import _bcrypt from "bcryptjs";
import _jwt from "jsonwebtoken";
import axios from 'axios';
import crypto from 'crypto';

// Variabili relative a MongoDB ed Express
import { MongoClient, ObjectId } from "mongodb";
const DBNAME = process.env.DBNAME;
const connectionString: string = process.env.connectionStringAtlas;

// Lettura delle password e parametri fondamentali
_dotenv.config({ "path": ".env" });
const { RestClientV5 } = require('bybit-api');

const PRIVATE_KEY = _fs.readFileSync("./keys/privateKey.pem", "utf8");
const CERTIFICATE = _fs.readFileSync("./keys/certificate.crt", "utf8");
const ENCRYPTION_KEY = _fs.readFileSync("./keys/encryptionKey.txt", "utf8");
const CREDENTIALS = { "key": PRIVATE_KEY, "cert": CERTIFICATE };
const app = _express();

// Creazione ed avvio del server
// app è il router di Express, si occupa di tutta la gestione delle richieste http
const PORT: number = parseInt(process.env.PORT);
let API_KEY_BYBIT = process.env.API_KEY_BYBIT;
let SECRET_API_KEY_BYBIT = process.env.SECRET_API_KEY_BYBIT;
let paginaErrore;
const server = _http.createServer(app);
// Il secondo parametro facoltativo ipAddress consente di mettere il server in ascolto su una delle interfacce della macchina, se non lo metto viene messo in ascolto su tutte le interfacce (3 --> loopback e 2 di rete)
server.listen(PORT, () => {
    init();
    console.log(`Il Server è in ascolto sulla porta ${PORT}`);
});

function init() {
    _fs.readFile("./static/error.html", function (err, data) {
        if (err) {
            paginaErrore = `<h1>Risorsa non trovata</h1>`;
        }
        else {
            paginaErrore = data.toString();
        }
    });
}

//********************************************************************************************//
// Routes middleware
//********************************************************************************************//

// 1. Request log
app.use("/", (req: any, res: any, next: any) => {
    console.log(`-----> ${req.method}: ${req.originalUrl}`);
    next();
});

// 2. Gestione delle risorse statiche
// .static() è un metodo di express che ha già implementata la firma di sopra. Se trova il file fa la send() altrimenti fa la next()
app.use("/", _express.static("./static"));

// 3. Lettura dei parametri POST di req["body"] (bodyParser)
// .json() intercetta solo i parametri passati in json nel body della http request
app.use("/", _express.json({ "limit": "50mb" }));
// .urlencoded() intercetta solo i parametri passati in urlencoded nel body della http request
app.use("/", _express.urlencoded({ "limit": "50mb", "extended": true }));

// 4. Aggancio dei parametri del FormData e dei parametri scalari passati dentro il FormData
// Dimensione massima del file = 10 MB
app.use("/", _fileUpload({ "limits": { "fileSize": (10 * 1024 * 1024) } }));

// 5. Log dei parametri GET, POST, PUT, PATCH, DELETE
app.use("/", (req: any, res: any, next: any) => {
    if (Object.keys(req["query"]).length > 0) {
        console.log(`       ${JSON.stringify(req["query"])}`);
    }
    if (Object.keys(req["body"]).length > 0) {
        console.log(`       ${JSON.stringify(req["body"])}`);
    }
    next();
});

//********************************************************************************************//
// Inizio codice specifico delle API Telegram Bot
//********************************************************************************************//

// URL base API Telegram
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Funzione per inviare un messaggio Telegram
async function sendTelegramMessage(chatId: string, text: string) {
    try {
        const res = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text
        });
        console.log("Messaggio Telegram inviato:", res.data);
    } catch (err: any) {
        console.error("Errore invio Telegram:", err.response?.data || err.message);
    }
}

// Funzione per gestire i messaggi in arrivo da Telegram (via webhook)
async function handleTelegramUpdate(update: any) {
    if (!update.message) return;

    const chatId = update.message.chat.id;
    const text = update.message.text;
    console.log(`📩 Messaggio da ${chatId}: ${text}`);

    // Esempio semplice di risposta automatica
    if (text === "/start") {
        await sendTelegramMessage(chatId, "👋 Ciao! Sono il tuo bot Telegram collegato al server Node.js.");
    } else if (text.toLowerCase().includes("ciao")) {
        await sendTelegramMessage(chatId, "Ciao anche a te! 😊");
    } else if (text == "/capitale") {
        await walletBalance("UNIFIED", chatId);
    } else if (text == "/analisi") {
        const risultati = await analisi(chatId);
        console.log(risultati);
        await sendTelegramMessage(chatId, `${JSON.stringify(risultati)}`);
    }
    else {
        await sendTelegramMessage(chatId, `Hai scritto: ${text}`);
    }
}


// Endpoint Webhook — riceve aggiornamenti da Telegram
app.post("/telegram/webhook", async (req: any, res: any) => {
    try {
        const update = req.body;
        await handleTelegramUpdate(update);
        res.send("ok");
    } catch (err) {
        console.error("Errore webhook Telegram:", err);
        res.status(500).send("Errore server webhook");
    }
});

// Endpoint per inviare messaggi manualmente via HTTP (utile per test)
app.get("/api/telegram/send", async (req: any, res: any) => {
    const chatId = req.query.chat_id;
    const msg = req.query.msg;

    if (!chatId || !msg) {
        return res.status(400).send("Parametri mancanti: chat_id e msg obbligatori");
    }

    await sendTelegramMessage(chatId, msg);
    res.send(`✅ Messaggio inviato a ${chatId}`);
});

// Endpoint per controllare lo stato del webhook (debug)
app.get("/api/telegram/info", async (req: any, res: any) => {
    try {
        const result = await axios.get(`${TELEGRAM_API}/getWebhookInfo`);
        res.send(result.data);
    } catch (err: any) {
        res.status(500).send(err.response?.data || err.message);
    }
});

//********************************************************************************************//
// Fine codice Telegram Bot
//********************************************************************************************//
//********************************************************************************************//
// Inizio codice specifico delle API ByBit
//********************************************************************************************//
async function walletBalance(account: any, chatId: any) {
    let accountType = account;
    const client = new RestClientV5({
        testnet: false,
        key: API_KEY_BYBIT,
        secret: SECRET_API_KEY_BYBIT,
    });

    client.getWalletBalance({ accountType: accountType, })
        .catch(async (error) => {
            await sendTelegramMessage(chatId, JSON.stringify(error));
        })
        .then(async (response) => {
            await sendTelegramMessage(chatId, String(response.result.list[0].totalEquity));
        });
};

async function placeMarketOrder(symbol: string, side: "Buy" | "Sell", qty: number) {
    const url = "https://api.bybit.com/v5/order/create";
    const timestamp = Date.now().toString();

    // Parametri dell'ordine
    const body = {
        category: "linear",
        symbol,
        side,
        orderType: "Market",
        qty,
        leverage: "5",
        timeInForce: "IOC"
    };

    // Firma (Bybit v5 richiede: timestamp + api_key + body_json)
    const payload = timestamp + API_KEY_BYBIT + JSON.stringify(body);
    const sign = crypto.createHmac("sha256", SECRET_API_KEY_BYBIT).update(payload).digest("hex");

    try {
        const response = await axios.post(
            url,
            body,
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-BAPI-API-KEY": API_KEY_BYBIT,
                    "X-BAPI-SIGN": sign,
                    "X-BAPI-TIMESTAMP": timestamp,
                    "X-BAPI-RECV-WINDOW": "5000"
                }
            }
        );

        console.log("Ordine inviato:", response.data);
        return response.data;

    } catch (err: any) {
        console.error("Errore nell'invio dell'ordine:", err.response?.data || err.message);
        throw err;
    }
}

async function getOpenPositions() {
    const url = "https://api.bybit.com/v5/position/list";

    const timestamp = Date.now().toString();
    const queryString = `category=linear&settleCoin=USDT`;

    // Firma richiesta
    const signature = crypto
        .createHmac("sha256", SECRET_API_KEY_BYBIT)
        .update(timestamp + API_KEY_BYBIT + "5000" + queryString)
        .digest("hex");

    try {
        const response = await axios.get(`${url}?${queryString}`, {
            headers: {
                "X-BAPI-API-KEY": API_KEY_BYBIT,
                "X-BAPI-SIGN": signature,
                "X-BAPI-TIMESTAMP": timestamp,
                "X-BAPI-RECV-WINDOW": "5000"
            }
        });

        const positions = response.data.result.list;
        console.log("data2" + JSON.stringify(response.data));
        // Filtra solo le posizioni realmente aperte (size > 0)
        const openPositions = positions.filter((p: any) => parseFloat(p.size) > 0);

        console.log("Posizioni aperte:", openPositions.length);
        return {
            count: openPositions.length,
            list: openPositions
        };

    } catch (err: any) {
        console.error("Errore nel recupero posizioni:", err.response?.data || err);
        return { count: 0, list: [] };
    }
}
//********************************************************************************************//
// Fine codice bybit
//********************************************************************************************//
//********************************************************************************************//
// Inizio logica bot
//********************************************************************************************//
// Funzione helper per calcolare media mobile semplice
function sma(data: number[], period: number): number {
    const slice = data.slice(0, period); // prendi le prime `period` candele
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
}

// Funzione helper per calcolare RSI (versione semplificata)
function rsi(data: number[], period: number): number {
    let gains = 0;
    let losses = 0;

    // Scorri le prime `period+1` candele perché useremo change tra candle[i] e candle[i+1]
    for (let i = 0; i < period; i++) {
        const change = data[i] - data[i + 1]; // invertito perché array più recente a indice 0
        if (change > 0) gains += change;
        else losses -= change;
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
}

/* async function checkMarket() {
    let pOpen = await getOpenPositions();  la funzione getOpenPositions() funziona e restituisce le posizioni aperte
    if (pOpen.count > 0) {
        console.log("Posizione già aperta, salto questo ciclo.");
        console.log(pOpen.list);
        return;
    }
    else {
        // 1. Prendi dati di mercato per ETHUSDT
        const symbol = "ETHUSDT";
        const interval = "1"; // timeframe 1 minuto
        const limit = 200;

        const response = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=1&limit=200`);

        const candles = response.data.result.list.map((c: any) => parseFloat(c[4]));
        //console.log("candles: " + candles);
        //console.log(JSON.stringify(response.data.result.list, null, 2));


        // 2. Calcolo indicatori
        const maFast = sma(candles, 10);
        const maSlow = sma(candles, 30);
        const currentRSI = rsi(candles, 14);
         const currentPrice = candles[0]; // primo elemento = prezzo corrente

        console.log(`MA10: ${maFast.toFixed(2)}, MA30: ${maSlow.toFixed(2)}, RSI: ${currentRSI.toFixed(2)}`);

        // 3. Decidi direzione mercato
        let action: "LONG" | "SHORT" | null = null;

        // Parametri di controllo extra
        const maDiffThreshold = 0.05; // percentuale minima tra MA per considerare un segnale valido
        const rsiOverbought = 55;
        const rsiOversold = 45;

        // Differenza percentuale tra MA
        const maDiffPercent = ((maFast - maSlow) / maSlow) * 100;

        // Logica per LONG
        if (maFast > maSlow && currentRSI < rsiOverbought && maDiffPercent > maDiffThreshold) {
            action = "LONG";
        }
        // Logica per SHORT
        else if (maFast < maSlow && currentRSI > rsiOversold && maDiffPercent < -maDiffThreshold) {
            action = "SHORT";
        }
        // Se nessuna condizione soddisfatta, action rimane null
        else {
            action = null;
        }

        console.log("Azione decisa:" + action + " con maDiffPercent: " + maDiffPercent.toFixed(2) + "%  ");

        // 4. Simula apertura ordine
        if (action) {
            const tpPercent = action === "LONG" ? 1 : -1; // TP +2% per long, -2% per short
            const slPercent = action === "LONG" ? -0.5 : 0.5; // SL -1% per long, +1% per short

            const takeProfit = currentPrice * (1 + tpPercent / 100);
            const stopLoss = currentPrice * (1 + slPercent / 100);

            console.log(`Avrei aperto un ordine ${action} a mercato su ETHUSDT a prezzo ${currentPrice.toFixed(2)}, Take Profit: ${takeProfit.toFixed(2)}, Stop Loss: ${stopLoss.toFixed(2)}`);
            //const qty = 5 / currentPrice;
            //await placeMarketOrder("ETHUSDT","Buy", qty)
            await sendTelegramMessage("@BotTradeDavide", `Avrei aperto un ordine ${action} a mercato su ETHUSDT a prezzo ${currentPrice.toFixed(2)}, Take Profit: ${takeProfit.toFixed(2)}, Stop Loss: ${stopLoss.toFixed(2)}`);
        } else {
            console.log("Nessuna opportunità di mercato rilevata su ETHUSDT in questo momento.");
            //await sendTelegramMessage("@BotTradeDavide",Nessuna opportunità di mercato rilevata su ETHUSDT in questo momento.);
        }
    }
}

// Esegui il controllo ogni minuto
setInterval(checkMarket, 60 * 1000); */

let pOpen = 0;
let action: "LONG" | "SHORT" | null = null;
let PPopen = 0;

async function checkMarketSimulation() {

    console.log("PoPEN INIZIO CHECK MERCATO: " + pOpen);
    if (pOpen > 0) {
        console.log("PoPEN IN IF >0: " + pOpen);
        console.log("Posizione già aperta. Controllo TP/SL sull’ultima candela...");

        // ==== 1) Scarico SOLO l'ultima candela chiusa ====
        const response = await axios.get(
            `https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=1&limit=2`
        );

        const lastCandle = response.data.result.list[1];
        // [1] = candela chiusa  → [0] è quella in formazione

        const high = parseFloat(lastCandle[2]);
        const low = parseFloat(lastCandle[3]);

        // ==== 2) Dati posizione ====
        const entryPrice = PPopen;
        const side = action;

        // ==== 3) Calcolo TP & SL ====
        const tpPercent = action === "LONG" ? (10 / 10) : -(10 / 10);  //10%tp su leva 10 e 3.33% sl su leva 10
        const slPercent = action === "LONG" ? -(3.33 / 10) : (3.33 / 10);

        const takeProfit = entryPrice * (1 + tpPercent / 100);
        const stopLoss = entryPrice * (1 + slPercent / 100);

        console.log(`Entry: ${entryPrice}, TP: ${takeProfit}, SL: ${stopLoss}`);

        // ==== 4) Controllo singola candela ====
        let result: "TP" | "SL" | "NONE" = "NONE";
        let exitPrice = entryPrice;

        if (side === "LONG") {

            if (low <= stopLoss) {
                result = "SL";
                exitPrice = stopLoss;
            }
            else if (high >= takeProfit) {
                result = "TP";
                exitPrice = takeProfit;
            }
        }

        if (side === "SHORT") {

            if (high >= stopLoss) {
                result = "SL";
                exitPrice = stopLoss;
            }
            else if (low <= takeProfit) {
                result = "TP";
                exitPrice = takeProfit;
            }
        }

        // ==== 5) Risultato ====
        if (result === "TP") {
            console.log(`✔️ PROFITTO: TP raggiunto a ${exitPrice}`);
            pOpen = 0;
            await sendTelegramMessage("@BotTradeDavide", `✔️ Posizione chiusa in PROFITTO a ${exitPrice}`);
        }
        else if (result === "SL") {
            console.log(`❌ PERDITA: SL raggiunto a ${exitPrice}`);
            pOpen = 0;
            await sendTelegramMessage("@BotTradeDavide", `❌ Posizione chiusa in PERDITA a ${exitPrice}`);
        }
        else {
            console.log("⏳ Nell'ultima candela NON è stato toccato né TP né SL.");
        }
    }
    else {
        console.log("PoPEN IN ELSE: " + pOpen);
        // 1. Prendi dati di mercato per ETHUSDT
        const symbol = "ETHUSDT";
        const interval = "1"; // timeframe 1 minuto
        const limit = 200;

        const response = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=ETHUSDT&interval=1&limit=200`);

        const candles = response.data.result.list.map((c: any) => parseFloat(c[4]));
        //console.log("candles: " + candles);
        //console.log(JSON.stringify(response.data.result.list, null, 2));


        // 2. Calcolo indicatori
        const maFast = sma(candles, 10);
        const maSlow = sma(candles, 30);
        const currentRSI = rsi(candles, 14);
        const currentPrice = candles[0]; // primo elemento = prezzo corrente

        console.log(`MA10: ${maFast.toFixed(2)}, MA30: ${maSlow.toFixed(2)}, RSI: ${currentRSI.toFixed(2)}`);

        // 3. Decidi direzione mercato
        //let action: "LONG" | "SHORT" | null = null;

        // Parametri di controllo extra
        const maDiffThreshold = 0.05; // percentuale minima tra MA per considerare un segnale valido
        const rsiOverbought = 55;
        const rsiOversold = 45;

        // Differenza percentuale tra MA
        const maDiffPercent = ((maFast - maSlow) / maSlow) * 100;

        // Logica per LONG
        if (maFast > maSlow && currentRSI < rsiOverbought && maDiffPercent > maDiffThreshold) {
            action = "LONG";
        }
        // Logica per SHORT
        else if (maFast < maSlow && currentRSI > rsiOversold && maDiffPercent < -maDiffThreshold) {
            action = "SHORT";
        }
        // Se nessuna condizione soddisfatta, action rimane null
        else {
            action = null;
        }

        console.log("Azione decisa:" + action + " con maDiffPercent: " + maDiffPercent.toFixed(2) + "%  ");

        // 4. Simula apertura ordine
        if (action) {
            const tpPercent = action === "LONG" ? (10 / 10) : -(10 / 10);
            const slPercent = action === "LONG" ? -(3.33 / 10) : (3.33 / 10);

            const takeProfit = currentPrice * (1 + tpPercent / 100);
            const stopLoss = currentPrice * (1 + slPercent / 100);

            console.log(`Avrei aperto un ordine ${action} a mercato su ETHUSDT a prezzo ${currentPrice.toFixed(2)}, Take Profit: ${takeProfit.toFixed(2)}, Stop Loss: ${stopLoss.toFixed(2)}`);
            //const qty = 5 / currentPrice;
            //await placeMarketOrder("ETHUSDT","Buy", qty)
            PPopen = currentPrice;
            pOpen = 1;
            console.log("PoPEN PRIMA AWAIT: " + pOpen);
            await sendTelegramMessage("@BotTradeDavide", `Avrei aperto un ordine ${action} a mercato su ETHUSDT a prezzo ${currentPrice.toFixed(2)}, Take Profit: ${takeProfit.toFixed(2)}, Stop Loss: ${stopLoss.toFixed(2)}`);
            console.log("PoPEN DOPO AWAIT: " + pOpen);
        } else {
            console.log("Nessuna opportunità di mercato rilevata su ETHUSDT in questo momento.");
            //await sendTelegramMessage("@BotTradeDavide",Nessuna opportunità di mercato rilevata su ETHUSDT in questo momento.);
        }
    }
}

// Esegui il controllo ogni minuto
let isChecking = false;

setInterval(async () => {
    if (isChecking) return;
    isChecking = true;
    await checkMarketSimulation();
    isChecking = false;
}, 60 * 1000);

//********************************************************************************************//
// Fine logica bot
//********************************************************************************************//
//********************************************************************************************//
// Chiamata a MongoDB
//********************************************************************************************//
async function analisi(chatId: any) {

    const client = new MongoClient(connectionString);
    await client.connect();

    let collection = client.db(DBNAME).collection("Trades");

    // ritorno la Promise
    let rq = collection.find({}).toArray();

    return rq
        .then((data) => {

            let vinti = 0;
            let persi = 0;

            data.forEach(t => {
                if (t.Vinto === true) vinti++;
                if (t.Perso === true) persi++;
            });

            return {
                totale: data.length,
                vinti,
                persi
            };
        })
        .catch((err) => {
            throw new Error("Errore esecuzione query: " + err);
        })
        .finally(() => client.close());
}

//********************************************************************************************//
// Fine chiamata a MongoDB
//********************************************************************************************//

//********************************************************************************************//
// Default route e gestione degli errori
//********************************************************************************************//

app.use("/", (req, res, next) => {
    res.status(404);
    if (req.originalUrl.startsWith("/api/")) {
        res.send(`Api non disponibile`);
    }
    else {
        res.send(paginaErrore);
    }
});

app.use("/", (err, req, res, next) => {
    console.log("************* SERVER ERROR ***************\n", err.stack);
    res.status(500).send(err.message);
});






