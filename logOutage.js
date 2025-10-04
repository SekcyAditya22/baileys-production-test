import fetch from "node-fetch";

// ================= Outage/Pemadaman Parsing Function 4 kelolaanee =================
function detectCustomer(text) {
  const t = text.toUpperCase();
  if (/\bATMI\b/i.test(t)) return "ATMi";
  if (/\bARTAJASA\b/.test(t)) return "ARTAJASA";
  if (/\bBRINKS\b/.test(t)) return "BRINKS";
  if (/\bJALIN\b/.test(t)) return "JALIN";
  return "";
}

function parseMultipleOutageData(rawText) {
  if (!rawText) return [];
  
  // Split text (ATMI, ARTAJASA, BRINKS, JALIN) penting ono keempat kui
  const lines = rawText.split('\n');
  let currentBlock = [];
  const blocks = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Cek kondisinya kalau ada di 4 kelolaan
    if (/^(ATMI|ATMi|ARTAJASA|BRINKS|JALIN)\s*$/i.test(line)) {
      // If we have a current block, save it
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
      }
      // Blok baru berdasarkan kelolaan
      currentBlock = [line];
    } else if (line) {
      // kalau ada isinya push line nya
      currentBlock.push(line);
    }
  }
  
  // Cek kalau diblok pesannya lebih dari satu di join terus dipisah.
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }
  
  console.log(`📊 [MULTI-PARSE] Found ${blocks.length} data blocks`);
  
  // Parse blok satu" ben ra nabrak (unit testing bree)
  const results = [];
  blocks.forEach((block, index) => {
    console.log(`🔍 [BLOCK ${index + 1}] Processing:`, block.substring(0, 50) + "...");
    const parsed = parseOutageData(block);
    if (parsed && parsed.customer) {
      results.push(parsed);
      console.log(`✅ [BLOCK ${index + 1}] Berhasil parse: ${parsed.customer}`);
    } else {
      console.log(`❌ [BLOCK ${index + 1}] Gagal parse atau kelolaan gaada`);
    }
  });
  
  return results;
}

function parseOutageData(rawText) {
  if (!rawText) return null;
  try {
    const text = rawText.replace(/^\[[^\]]+\]\s*[^:]*:\s*/gm, "");
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const afterFirstColon = (l) => l.replace(/^[^:]*:\s*/, "").trim();

    const parsed = {
      customer: detectCustomer(text),
      idAtm: "",
      lokasi: "",
      area: "",
      downtimeDate: "",
      downtimeTime: "",
      uptimeDate: "",
      uptimeTime: "",
      duration: "",
      confirmBy: "",
      remarks: ""
    };

    const idLocLine = lines.find(l => /-/.test(l));
    if (idLocLine) {
      // Parsing untuk menangani berbagai format strip
      const pattern = /^([A-Za-z0-9\-]+)\s*-\s*(.+)$/;
      const match = idLocLine.match(pattern);
      
      if (match) {
        parsed.idAtm = match[1].trim();
        parsed.lokasi = match[2].trim();
      } else {
        // Fallback untuk format lama yang mungkin berbeda
        if (idLocLine.includes(" - ")) {
          const [left, right] = idLocLine.split(" - ", 2);
          parsed.idAtm = (left || "").trim();
          parsed.lokasi = (right || "").trim();
        } else {
          // Final fallback
          const parts = idLocLine.split(/\s*-\s*/, 2);
          parsed.idAtm = (parts[0] || "").trim();
          parsed.lokasi = (parts[1] || "").trim();
        }
      }
    }

    const areaLine = lines.find(l => /^Area\s*:/i.test(l));
    if (areaLine) parsed.area = afterFirstColon(areaLine);

    const problemLine = lines.find(l => /^Problem\s*:/i.test(l));
    if (problemLine) parsed.remarks = afterFirstColon(problemLine);

    const timeLine = lines.find(l => /^Pukul\s*:|^Pukul/i.test(l));
    if (timeLine) {
      const raw = afterFirstColon(timeLine);
      const timeMatch = raw.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
      parsed.downtimeTime = (timeMatch ? timeMatch[1] : raw).trim();
    }

    const infoLine = lines.find(l => /^Info\s*:/i.test(l));
    if (infoLine) parsed.confirmBy = afterFirstColon(infoLine);

    const dateMatch = text.match(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/);
    if (dateMatch) {
      parsed.downtimeDate = dateMatch[1];
    } else {
      const bulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
      const now = new Date();
      parsed.downtimeDate = `${now.getDate()} ${bulan[now.getMonth()]} ${now.getFullYear()}`;
    }

    return parsed;
  } catch (e) {
    console.error("Parse outage error", e);
    return null;
  }
}

// ================= Google Sheets Functions buat Outage atau Pemadaman =================
async function appendToOutageSheet(values, getAccessToken, SHEET_ID, getOutageSheetName) {
  try {
    const accessToken = await getAccessToken();
    const sheetName = getOutageSheetName();
    
    console.log(`📋 [OUTAGE] Sheet yg dipakai: ${sheetName}`);

    // Kolom B dari baris 4-1000 untuk cari baris kosong
    const checkUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}!B4:B1000`;
    const checkRes = await fetch(checkUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const checkData = await checkRes.json();
    const existing = checkData.values || [];

    // Cari baris kosong pertama (customer kosong)
    let nextRow = 4;
    for (let i = 0; i < 997; i++) { // 997 baris = 4 sampai 1000
      const cell = existing[i] ? existing[i][0] : "";
      if (!cell || cell.trim() === "") {
        nextRow = 4 + i;
        break;
      }
    }

    console.log(`📍 [OUTAGE] Baris kosong ada di ${nextRow}`);

    // 2. Tembak baris kosong (pakai append bug terus bzirlah, pakai PUT!)
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}!B${nextRow}:L${nextRow}?valueInputOption=USER_ENTERED`;

    const valuesWithoutNo = values.slice(1); // skip kolom A
    const body = { values: [valuesWithoutNo] };

    const res = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    console.log("📡 [OUTAGE] Response status:", res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error("❌ [OUTAGE] Gagal update sheet:", errorText);
    } else {
      const responseData = await res.json();
      console.log("✅ [OUTAGE] Data berhasil ditambahkan di baris:", nextRow);
      console.log("📍 [OUTAGE] updatedRange:", responseData.updatedRange || responseData);
    }
  } catch (error) {
    console.error("❌ [OUTAGE] Error dalam appendToOutageSheet:", error);
  }
}

// ================= Kondisi nek satu chat ada beberapa block!! =================
async function processOutageEntries(text, messageInfo, getAccessToken, SHEET_ID, formatWaTimestamp, getOutageSheetName) {
  console.log("⚡ Processing as OUTAGE data...");
  const outageParsedArray = parseMultipleOutageData(text);
  
  if (outageParsedArray.length > 0) {
    console.log(`✅ Found ${outageParsedArray.length} OUTAGE entries`);
    
    // Process beberapa entry masuk
    for (let i = 0; i < outageParsedArray.length; i++) {
      const outageParsed = outageParsedArray[i];
      const values = [
        "", // kolom A diskip
        outageParsed.customer || "",
        outageParsed.idAtm || "",
        outageParsed.lokasi || "",
        outageParsed.area || "",
        outageParsed.downtimeDate || "",
        outageParsed.downtimeTime || "",
        outageParsed.uptimeDate || "",
        outageParsed.uptimeTime || "",
        outageParsed.duration || "",
        outageParsed.confirmBy || "",
        outageParsed.remarks || ""
      ];

      await appendToOutageSheet(values, getAccessToken, SHEET_ID, getOutageSheetName);
      
      const tsSeconds = messageInfo.messageTimestamp ? Number(messageInfo.messageTimestamp) : null;
      const timestamp = tsSeconds ? formatWaTimestamp(tsSeconds) : "";
      
      console.log(`✅ [OUTAGE ${i + 1}/${outageParsedArray.length}] Data tersimpan:`, { 
        from: messageInfo.remoteJid, 
        customer: outageParsed.customer,
        idAtm: outageParsed.idAtm,
        timestamp 
      });
    }
    return true;
  }
  return false;
}

export {
  parseMultipleOutageData,
  parseOutageData,
  detectCustomer,
  processOutageEntries
};