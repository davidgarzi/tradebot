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
    } else if (text=="/capitale") {
        await walletBalance("UNIFIED", chatId);
    }
    else  {
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

async function walletBalance(account: any, chatId: any) {
    let accountType = account;
    const client = new RestClientV5({
        testnet: false,
        key: API_KEY_BYBIT,
        secret: SECRET_API_KEY_BYBIT,
    });

    client.getWalletBalance({accountType: accountType,})
    .catch(async (error) => {
        await sendTelegramMessage(chatId, JSON.stringify(error));
    })
    .then(async (response) => {
        await sendTelegramMessage(chatId, String(response.result.list[0].totalEquity));
    });
};

//********************************************************************************************//
// Inizio codice specifico delle API ByBit
//********************************************************************************************//




//********************************************************************************************//
// Fine codice Telegram Bot
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






