import { GoogleAuth } from "google-auth-library";
import fs from "fs";

// ================= Configuration =================
const SHEET_ID = "1q9tBmX0tFECV6Em4k0zMtWK9Etp2htGMKsTPr3nlMuo"; // Outage Pemadaman Cuyy
const MAINTENANCE_SHEET_ID = "1oS0fvOR22HKxTEOCCOL-nOqd4zSqELYlKfYUqtr7od8"; // Maintenance sheet (masih gabungan)

// =================SHEET NAME JANGAN LUPA =================
const SHEET_NAMES = {
  // Outage Sheet bulan/periode
  OUTAGE: {
    JANUARY: "lewat",     
    FEBRUARY: "lewat",    
    MARCH: "lewat",        
    APRIL: "lewat",       
    MAY: "lewat",            
    JUNE: "lewat",           
    JULY: "lewat",          
    AUGUST: "lewat",      
    SEPTEMBER: "lewat",  
    OCTOBER: "Oktober 2025",      
    NOVEMBER: "November 2025",    
    DECEMBER: "Desember 2025",    
    DEFAULT: "Sheet1"    
  },
  
  // Maintenance bulan/periode  
  MAINTENANCE: {
    JANUARY: "lewat",      // gid  
    FEBRUARY: "lewat",  
    MARCH: "lewat",        
    APRIL: "lewat",         
    MAY: "lewat",           
    JUNE: "lewat",          
    JULY: "lewat",          
    AUGUST: "lewat",       
    SEPTEMBER: "lewat", 
    OCTOBER: "Oktober 2025",      
    NOVEMBER: "November 2025",    
    DECEMBER: "Desember 2025",    
    DEFAULT: "Sheet1"     
  }
};

// ================= Dinamik std wwae =================
function getCurrentMonth() {
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", 
                  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  const now = new Date();
  return months[now.getMonth()];
}

function getOutageSheetName(month = null) {
  const targetMonth = month || getCurrentMonth();
  return SHEET_NAMES.OUTAGE[targetMonth] || SHEET_NAMES.OUTAGE.DEFAULT;
}

function getMaintenanceSheetName(month = null) {
  const targetMonth = month || getCurrentMonth();
  return SHEET_NAMES.MAINTENANCE[targetMonth] || SHEET_NAMES.MAINTENANCE.DEFAULT;
}

// ================= Google Auth =================
function resolveServiceAccountPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const candidates = [
    "service-account.json",
    "baileys-spreedsheet-ee6604baf630.json",
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return "service-account.json"; // default
}

const SERVICE_ACCOUNT_PATH = resolveServiceAccountPath();

function getGoogleAuth() {
  return new GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getAccessToken() {
  try {
    const auth = getGoogleAuth();
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token?.token || "";
  } catch (error) {
    console.error("❌ Error access token token:", error);
    return "";
  }
}

// ================= Utils tambahan =================
function formatWaTimestamp(seconds) {
  if (!seconds && seconds !== 0) return "";
  const d = new Date(Number(seconds) * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export {
  SHEET_ID,
  MAINTENANCE_SHEET_ID,
  SHEET_NAMES,
  getAccessToken,
  formatWaTimestamp,
  getCurrentMonth,
  getOutageSheetName,
  getMaintenanceSheetName
};