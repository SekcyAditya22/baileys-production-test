import fetch from "node-fetch";

// ================= Maintenance Parsing Functions =================
function detectKelolaan(text) {
  const rawLines = text.split('\n');
  // Ignore lines that declare CIT to avoid false positives (e.g., CIT: BRINKS)
  const lines = rawLines.filter(l => !/^\s*CIT\s*:/i.test(l));

  // Prefer explicit header patterns like "Preventive Maintenance <Kelolaan>" or "Open Tiket <Kelolaan>"
  const headerLine = lines.find(l => /Preventive\s+Maintenance/i.test(l) || /Open\s*Tiket/i.test(l) || /Open\s*Ticket/i.test(l));
  if (headerLine) {
    const h = headerLine;
    if (/\bATM[-\s]?I\b/i.test(h) || /\bATMI\b/i.test(h)) return 'ATMi';
    if (/\bBRINKS\b/i.test(h)) return 'BRINKS';
    if (/\bARTAJASA\b/i.test(h) || /\bAJ\b/i.test(h)) return 'ARTAJASA';
    if (/\bJALIN\b/i.test(h)) return 'JALIN';
  }

  // Fallback: scan early lines (still ignoring CIT)
  const firstChunk = lines.slice(0, 12).join(' ');
  if (/\bATM[-\s]?I\b/i.test(firstChunk) || /\bATMI\b/i.test(firstChunk)) return 'ATMi';
  if (/\bBRINKS\b/i.test(firstChunk)) return 'BRINKS';
  if (/\bARTAJASA\b/i.test(firstChunk) || /\bAJ\b/i.test(firstChunk)) return 'ARTAJASA';
  if (/\bJALIN\b/i.test(firstChunk)) return 'JALIN';
  return '';
}

function normalizeKegiatan(raw) {
  const s = raw.toUpperCase();
  if (s.includes('PREVENTIVE')) return 'PREVENTIVE MAINTENANCE (PM)';
  if (s.includes('OPEN TICKET') || s.includes('OPEN TIKET') || s.includes('(OT)') || s === 'OT') return 'OPEN TICKET (OT)';
  if (s.includes('DISMANTLE')) return 'DISMANTLE';
  if (s.includes('RELOKASI') || s.includes('RELOCATION')) return 'RELOKASI';
  if (s.includes('REAKTIVASI') || s.includes('REACTIVATION')) return 'REAKTIVASI';
  return raw.toUpperCase();
}

function normalizeTypeAction(sourceActions) {
  const joined = sourceActions.join(' ').toUpperCase();
  
  // Check untuk REPLACE MODEM
  if (/(REPLACE\s*MODEM|GANTI\s*MODEM)/.test(joined)) return 'REPLACE MODEM';
  
  // Check untuk REPLACE SIMCARD/PROVIDER - PRIORITY TINGGI
  // Jika ada kata "replace simcard" atau "replace provider", langsung dianggap REPLACE PROVIDER/SIMCARD
  // MESKIPUN ada juga maintenance activities (karena bisa ada 2 simcard: 1 replace, 1 maintenance)
  if (/(REPLACE.*(PROVIDER|SIM)|GANTI.*(PROVIDER|SIM))/.test(joined)) {
    return 'REPLACE PROVIDER/SIMCARD';
  }
  
  // Jika TIDAK ada replace simcard/provider, baru cek maintenance-only activities
  return 'OTHER';
}

function normalizeTypeModem(raw) {
  const s = raw.toUpperCase();
  if (s.includes('RBM33')) return 'RBM33';
  if (s.includes('RB951')) return 'RB951';
  return raw;
}

function parseMultipleMaintenanceData(rawText) {
  if (!rawText) return [];
  
  // Split text berdasarkan nama customer untuk maintenance
  const lines = rawText.split('\n');
  let currentBlock = [];
  const blocks = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if this line is a customer name or maintenance header
    if (/^(ATMI|ATMi|ARTAJASA|BRINKS|JALIN)\s*$/i.test(line) || 
        /Preventive\s+Maintenance/i.test(line) ||
        /Open\s*Tiket/i.test(line)) {
      
      // If we have a current block, save it
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
      }
      // Start new block
      currentBlock = [line];
    } else if (line) {
      // Add non-empty lines to current block
      currentBlock.push(line);
    }
  }
  
  // Don't forget the last block
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }
  
  console.log(`📊 [MULTI-MAINTENANCE] Found ${blocks.length} maintenance blocks`);
  
  // Parse each block individually
  const results = [];
  blocks.forEach((block, index) => {
    console.log(`🔧 [MAINTENANCE-BLOCK ${index + 1}] Processing:`, block.substring(0, 50) + "...");
    const parsed = parseMaintenanceData(block);
    if (parsed && parsed.kelolaan) {
      results.push(parsed);
      console.log(`✅ [MAINTENANCE-BLOCK ${index + 1}] Successfully parsed: ${parsed.kelolaan}`);
    } else {
      console.log(`❌ [MAINTENANCE-BLOCK ${index + 1}] Failed to parse or no kelolaan found`);
    }
  });
  
  return results;
}

function parseMaintenanceData(text) {
  try {
    const kelolaan = detectKelolaan(text);
    const rawLines = text.split('\n').map(line => line.trim());
    const lines = rawLines.filter(line => line.length > 0);

    const afterFirstColon = (l) => l.replace(/^[^:]*:\s*/, '').trim();
    const isBullet = (l) => l.startsWith('*') || l.startsWith('-');
    const stripBullet = (l) => l.replace(/^([*-]\s*)/, '').trim();

    const parsed = {
      kelolaan,
      tanggalKunjungan: '',
      idAtm: '',
      lokasi: '',
      area: '',
      waktuKunjungan: '',
      serialNumber: '',
      problems: [],
      actions: [],
      kegiatan: '',
      typeAction: '',
      typeModemBaru: '',
      status: '',
      keterangan: '',
      selesai: '',
      picMt: '',
      picToko: '',
      picFlm: ''
    };

    let currentSection = null;

    lines.forEach(line => {
      if (/^Problem\s*:/.test(line)) {
        const inline = afterFirstColon(line);
        if (inline) parsed.problems.push(inline);
        currentSection = 'PROBLEM';
        return;
      }
      if (/^Action\s*:/.test(line)) {
        const inline = afterFirstColon(line);
        if (inline) {
          const parts = inline.split(/,|\s+dan\s+|\s+&\s+/i).map(s => s.trim()).filter(Boolean);
          if (parts.length) parsed.actions.push(...parts);
        }
        currentSection = 'ACTION';
        return;
      }

      if (currentSection === 'PROBLEM' && isBullet(line)) { parsed.problems.push(stripBullet(line)); return; }
      if (currentSection === 'ACTION' && isBullet(line)) { parsed.actions.push(stripBullet(line)); return; }

      if (!isBullet(line)) currentSection = null;

      if (/Open\s*Tiket/i.test(line) || /\(OT\)/i.test(line)) parsed.kegiatan = 'OPEN TICKET (OT)';

      if (line.includes('Tanggal Kunjungan')) parsed.tanggalKunjungan = afterFirstColon(line);
      else if (/^Tgl\s*Kunjungan/i.test(line)) parsed.tanggalKunjungan = afterFirstColon(line);
      else if (line.startsWith('ID ATM')) parsed.idAtm = afterFirstColon(line);
      else if (line.toUpperCase().startsWith('LOKASI')) parsed.lokasi = afterFirstColon(line);
      else if (/^Relokasi\s*ke/i.test(line)) parsed.lokasi = afterFirstColon(line);
      else if (/^Lokasi\s+Lama/i.test(line)) {
        const oldLoc = afterFirstColon(line);
        if (oldLoc) parsed.keterangan = parsed.keterangan ? `${parsed.keterangan}\nLokasi Ex${oldLoc}` : `Lokasi Ex${oldLoc}`;
      }
      else if (line.toUpperCase().startsWith('AREA')) parsed.area = afterFirstColon(line);
      else if (line.startsWith('Waktu Kunjungan')) parsed.waktuKunjungan = afterFirstColon(line);
      else if (line.toUpperCase().startsWith('SERIAL NUMBER')) parsed.serialNumber = afterFirstColon(line);
      else if (line.toUpperCase().startsWith('KEGIATAN')) parsed.kegiatan = normalizeKegiatan(afterFirstColon(line));
      else if (line.toUpperCase().startsWith('TYPE MODEM')) parsed.typeModemBaru = normalizeTypeModem(afterFirstColon(line));
      else if (line.startsWith('Status')) {
        const statusRaw = afterFirstColon(line);
        const s = statusRaw.toLowerCase();
        if (s.includes('atm online') && s.includes('dual')) {
          parsed.status = 'ATM Online, UP dual link';
        } else {
          parsed.status = statusRaw;
        }
        const upsNote = statusRaw.match(/\(([^)]*ups[^)]*)\)/i);
        if (upsNote && upsNote[1]) {
          const text = upsNote[1].replace(/\s+/g,' ').trim();
          parsed.keterangan = parsed.keterangan ? `${parsed.keterangan} kelistrikan ATM dan Modem : ${text}` : `kelistrikan ATM dan Modem : ${text}`;
        }
      }
      else if (line.startsWith('Selesai')) parsed.selesai = afterFirstColon(line);
      else if (line.startsWith('PIC MT')) parsed.picMt = afterFirstColon(line);
      else if (line.startsWith('PIC Toko')) parsed.picToko = afterFirstColon(line);
      else if (line.startsWith('PIC FLM')) parsed.picFlm = afterFirstColon(line);
      else if ((/UPS/i.test(line) || /Kelistrikan/i.test(line)) && !/Jam Operasional/i.test(line)) {
        const val = afterFirstColon(line) || line;
        
        // Handle specific format: "Kelistrikan ATM dan Modem : Menggunakan UPS"
        if (/Kelistrikan\s*ATM\s*dan\s*Modem/i.test(line)) {
          const keteranganValue = afterFirstColon(line);
          if (keteranganValue) {
            // Transform various UPS formats:
            // "Menggunakan UPS" → "ATM dan Modem menggunakan UPS"
            // "Tidak Menggunakan UPS" → "ATM dan Modem tidak menggunakan UPS"  
            // "UPS" → "ATM dan Modem menggunakan UPS"
            let finalKeterangan;
            const cleanValue = keteranganValue.trim();
            
            if (/menggunakan\s*ups/i.test(cleanValue)) {
              if (/tidak\s*menggunakan\s*ups/i.test(cleanValue)) {
                finalKeterangan = "ATM dan Modem tidak menggunakan UPS";
              } else {
                finalKeterangan = "ATM dan Modem menggunakan UPS";
              }
            } else if (/^ups$/i.test(cleanValue)) {
              // Handle simple "UPS" format
              finalKeterangan = "ATM dan Modem menggunakan UPS";
            } else if (/tidak.*ups/i.test(cleanValue) || /no.*ups/i.test(cleanValue)) {
              // Handle "Tidak UPS", "No UPS", etc.
              finalKeterangan = "ATM dan Modem tidak menggunakan UPS";
            } else {
              // Format lain, gunakan as-is
              finalKeterangan = cleanValue;
            }
            parsed.keterangan = parsed.keterangan ? `${parsed.keterangan}\n${finalKeterangan}` : finalKeterangan;
          } else {
            parsed.keterangan = parsed.keterangan ? `${parsed.keterangan}\n${val}` : val;
          }
        } else {
          parsed.keterangan = parsed.keterangan ? `${parsed.keterangan}\n${val}` : val;
        }
      } else if (/RBM(33|951)/i.test(line)) {
        parsed.typeModemBaru = normalizeTypeModem(line);
      }
    });

    if (!parsed.kegiatan) {
      const textUpper = lines.join(' ').toUpperCase();
      if (textUpper.includes('PREVENTIVE')) parsed.kegiatan = 'PREVENTIVE MAINTENANCE (PM)';
      else if (textUpper.includes('OPEN TICKET') || textUpper.includes('OPEN TIKET') || textUpper.includes('(OT)') || /\bOT\b/.test(textUpper)) parsed.kegiatan = 'OPEN TICKET (OT)';
      else if (textUpper.includes('DISMANTLE')) parsed.kegiatan = 'DISMANTLE';
      else if (textUpper.includes('RELOKASI')) parsed.kegiatan = 'RELOKASI';
      else if (textUpper.includes('REAKTIVASI')) parsed.kegiatan = 'REAKTIVASI';
    }
    parsed.typeAction = normalizeTypeAction(parsed.actions);

    // Infer TYPE Modem (Baru) from ACTION bullets if not explicitly provided
    if (!parsed.typeModemBaru && parsed.actions.length) {
      const joined = parsed.actions.join(' ').toUpperCase();
      
      // Deteksi RBM33 - baik dari nama langsung atau dari replace pattern
      if (/RBM\s*33|RBM33/.test(joined)) {
        parsed.typeModemBaru = 'RBM33';
      } 
      // Deteksi "Replace Modem ke RBM", "Replace to RBM", "Replace RBM", dll
      else if (/(REPLACE.*MODEM.*(KE|TO)\s*RBM|REPLACE.*RBM|GANTI.*MODEM.*(KE|TO)\s*RBM|GANTI.*RBM)/.test(joined)) {
        parsed.typeModemBaru = 'RBM33';
      }
      // Deteksi RB951 - baik dari nama langsung atau dari replace pattern  
      else if (/RB\s*951|RB951/.test(joined)) {
        parsed.typeModemBaru = 'RB951';
      }
      // Deteksi "Replace Modem ke RB951", dll
      else if (/(REPLACE.*MODEM.*(KE|TO)\s*RB951|REPLACE.*RB951|GANTI.*MODEM.*(KE|TO)\s*RB951|GANTI.*RB951)/.test(joined)) {
        parsed.typeModemBaru = 'RB951';
      }
    }

    return parsed;
  } catch (e) {
    console.error('Error parsing maintenance data:', e);
    return null;
  }
}

function parseTime(t) {
  const m = t.replace(/\bWIB\b/i, '').match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  return h * 60 + mm;
}

function stripWIB(v) {
  return v.replace(/\bWIB\b/i, '').trim();
}

function formatDurationHMS(start, end) {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s == null || e == null) return '';
  let diff = e - s;
  if (diff < 0) diff += 24 * 60;
  const hh = Math.floor(diff / 60).toString().padStart(2, '0');
  const mm = Math.floor(diff % 60).toString().padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function pickPic(d) {
  return d.picMt || d.picFlm || d.picToko || '';
}

function generateMaintenanceSpreadsheetData(data) {
  const awal = stripWIB(data.waktuKunjungan);
  const akhir = stripWIB(data.selesai);
  const durasi = awal && akhir ? formatDurationHMS(awal, akhir) : '';
  const customer = data.kelolaan;

  const problemsField = data.problems.length > 1
    ? data.problems.map(p => `- ${p}`).join('\n')
    : (data.problems[0] || '');
  const actionsField = data.actions.length > 1
    ? data.actions.map(a => `- ${a}`).join('\n')
    : (data.actions[0] || '');

  const values = [
    "", // No (kolom A) - akan di-skip saat kirim ke sheet untuk menjaga nomor yang sudah ada
    customer, // Customer (kolom B)
    data.tanggalKunjungan, // Tanggal (kolom C)
    data.kegiatan, // Kegiatan (kolom D)
    data.idAtm, // ID ATM (kolom E)
    data.serialNumber, // SERIAL NUMBER (kolom F)
    data.lokasi, // Lokasi (kolom G)
    problemsField, // PROBLEM (kolom H)
    awal, // Awal Kunjungan (kolom I)
    data.typeAction, // TYPE ACTION (kolom J)
    data.typeModemBaru, // TYPE Modem (Baru) (kolom K)
    actionsField, // ACTION (kolom L)
    akhir, // Akhir Kunjungan (kolom M)
    durasi, // Durasi (kolom N)
    pickPic(data), // PIC (kolom O)
    data.status, // STATUS (kolom P)
    data.keterangan || '' // Keterangan (kolom Q)
  ];
  
  return values;
}

// ================= Google Sheets Functions for Maintenance =================
async function appendToMaintenanceSheet(values, getAccessToken, MAINTENANCE_SHEET_ID, getMaintenanceSheetName) {
  try {
    const accessToken = await getAccessToken();
    const sheetName = getMaintenanceSheetName();
    
    console.log(`📋 [MAINTENANCE] Using sheet: ${sheetName}`);

    // 1. Ambil data kolom B dari baris 4-1000 untuk cari baris kosong (untuk maintenance sheet)
    const checkUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MAINTENANCE_SHEET_ID}/values/${sheetName}!B4:B1000`;
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

    console.log(`📍 [MAINTENANCE] Baris kosong ditemukan di baris ${nextRow}`);

    // 2. Update baris kosong itu - HANYA kolom B sampai Q (skip kolom A untuk menjaga nomor)
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MAINTENANCE_SHEET_ID}/values/${sheetName}!B${nextRow}:Q${nextRow}?valueInputOption=USER_ENTERED`;

    // Skip kolom A (nomor) dari values array
    const valuesWithoutNo = values.slice(1); // Hapus elemen pertama (kolom A)
    const body = { values: [valuesWithoutNo] };

    const res = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    console.log("📡 [MAINTENANCE] Response status:", res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error("❌ [MAINTENANCE] Gagal update sheet:", errorText);
    } else {
      const responseData = await res.json();
      console.log("✅ [MAINTENANCE] Data berhasil ditambahkan di baris:", nextRow);
      console.log("📍 [MAINTENANCE] updatedRange:", responseData.updatedRange || responseData);
      console.log("📋 [MAINTENANCE] Nomor di kolom A tetap terjaga!");
    }
  } catch (error) {
    console.error("❌ [MAINTENANCE] Error dalam appendToMaintenanceSheet:", error);
  }
}

// ================= Detection Function =================
function isMaintenanceData(text) {
  const t = text.toUpperCase();
  // Cek kata kunci yang menandakan maintenance
  return /PREVENTIVE\s*MAINTENANCE/i.test(t) || 
         /OPEN\s*TICKET?/i.test(t) || 
         /OPEN\s*TIKET/i.test(t) ||
         /\(PM\)/i.test(t) ||
         /\(OT\)/i.test(t) ||
         /DISMANTLE/i.test(t) ||
         /RELOKASI/i.test(t) ||
         /REAKTIVASI/i.test(t) ||
         /KEGIATAN\s*:/i.test(t) ||
         /WAKTU\s*KUNJUNGAN/i.test(t) ||
         /SERIAL\s*NUMBER/i.test(t) ||
         /TYPE\s*MODEM/i.test(t) ||
         /ACTION\s*:/i.test(t);
}

// ================= Process Multiple Maintenance Entries =================
async function processMaintenanceEntries(text, messageInfo, getAccessToken, MAINTENANCE_SHEET_ID, formatWaTimestamp, getMaintenanceSheetName) {
  console.log("🔧 Processing as MAINTENANCE data...");
  const maintenanceParsedArray = parseMultipleMaintenanceData(text);
  
  if (maintenanceParsedArray.length > 0) {
    console.log(`✅ Found ${maintenanceParsedArray.length} MAINTENANCE entries`);
    
    // Process each maintenance entry
    for (let i = 0; i < maintenanceParsedArray.length; i++) {
      const maintenanceParsed = maintenanceParsedArray[i];
      const values = generateMaintenanceSpreadsheetData(maintenanceParsed);
      
      await appendToMaintenanceSheet(values, getAccessToken, MAINTENANCE_SHEET_ID, getMaintenanceSheetName);
      
      const tsSeconds = messageInfo.messageTimestamp ? Number(messageInfo.messageTimestamp) : null;
      const timestamp = tsSeconds ? formatWaTimestamp(tsSeconds) : "";
      
      console.log(`✅ [MAINTENANCE ${i + 1}/${maintenanceParsedArray.length}] Data tersimpan:`, { 
        from: messageInfo.remoteJid, 
        customer: maintenanceParsed.kelolaan,
        idAtm: maintenanceParsed.idAtm,
        timestamp 
      });
    }
    return true;
  }
  return false;
}

export {
  parseMultipleMaintenanceData,
  parseMaintenanceData,
  detectKelolaan,
  isMaintenanceData,
  processMaintenanceEntries
};