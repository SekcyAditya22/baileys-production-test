import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";

// Import dari config
import { 
  SHEET_ID, 
  MAINTENANCE_SHEET_ID, 
  getAccessToken, 
  formatWaTimestamp, 
  getOutageSheetName, 
  getMaintenanceSheetName 
} from "./config.js";
import { processOutageEntries } from "./logOutage.js";
import { isMaintenanceData, processMaintenanceEntries } from "./logMaintenance.js";

// ================= Utils tambahan =================
function extractTextMessage(message) {
  if (!message) return "";
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) return message.listResponseMessage.singleSelectReply.selectedRowId;
  return "";
}

// ================= Bot WhatsApp baileys std=================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const sock = makeWASocket({
    auth: state,
    browser: ["Desktop", "Chrome", "121.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("QR Cihuyy");
      try {
        qrcodeTerminal.generate(qr, { small: true });
      } catch {
        console.log("Salin QR ke generator online", qr);
      }
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(startBot, 1500);
      else console.log("Anda logout. Hapus folder 'session' trs masuk lagi.");
    }
    if (connection) console.log("Status koneksi:", connection);
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    const text = extractTextMessage(msg.message).trim();
    if (!text) return;
    
    console.log("📨 Pesan masuk:", text.substring(0, 100) + (text.length > 100 ? "..." : ""));

    const messageInfo = {
      messageTimestamp: msg.messageTimestamp,
      remoteJid: msg.key.remoteJid
    };

    // Deteksi dan proses dr jenis data e.
    if (isMaintenanceData(text)) {
      const processed = await processMaintenanceEntries(
        text, 
        messageInfo, 
        getAccessToken, 
        MAINTENANCE_SHEET_ID, 
        formatWaTimestamp,
        getMaintenanceSheetName
      );
      if (processed) return;
    }

    // Jika bukan maintenance atau maintenance processing gagal, maka ke pemadaman (outage)
    const outageProcessed = await processOutageEntries(
      text, 
      messageInfo, 
      getAccessToken, 
      SHEET_ID, 
      formatWaTimestamp,
      getOutageSheetName
    );
    
    if (!outageProcessed) {
      console.log("❌ Data tidak ter-parse sebagai maintenance atau outage, atau customer tidak ditemukan");
      console.log("📋 Text received:", text.substring(0, 200) + "...");
    }
  });
}

console.log("🚀 Starting WhatsApp Bot...");
console.log("📊 Outage Sheet ID:", SHEET_ID);
console.log("🔧 Maintenance Sheet ID:", MAINTENANCE_SHEET_ID);
console.log("📅 Current Outage Sheet:", getOutageSheetName());
console.log("📅 Current Maintenance Sheet:", getMaintenanceSheetName());

startBot();

// ================= Error handler =================
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));
process.on("unhandledRejection", (reason) => console.error("Unhandled Rejection:", reason));