const { google } = require('googleapis');
const axios = require('axios');
const http = require('http');
const url = require('url');

// --- Yapılandırma ---
const SPREADSHEET_ID = '1OOc9on8hfMkf9aZJuDZKX_UsiH2EjbZEQYbwexr5Uds';
const REQUEST_TIMEOUT = 20000;
const BATCH_UPDATE_INTERVAL = 300000; // 5 dakika

const COUNTRIES = {
  'DE': { column: 'D', currency: 'EUR', marketplace_id: 'A1PA6795UKMFR9' },
  'IT': { column: 'E', currency: 'EUR', marketplace_id: 'APJ6JRA9NG5V4' },
  'ES': { column: 'F', currency: 'EUR', marketplace_id: 'A1RKKUPIHCS9HS' },
  'FR': { column: 'G', currency: 'EUR', marketplace_id: 'A13V1IB3VIYZZH' }
};

// --- Global Durum Değişkenleri ---
let apiCredentials = null;
let accessToken = null;
let tokenExpiry = null;
let allResults = [];
let startTime = Date.now();
let currentDelayMs = 1900;

// İşlem Kontrol Değişkenleri
let isJobRunning = false;
let isPaused = false;
let shouldStop = false;
let processedTasks = 0;
let totalTasks = 0;

// --- Yardımcı Fonksiyonlar ---
function loadApiCredentials() {
  try {
    if (!process.env.API_CREDENTIALS) {
      console.error('❌ API_CREDENTIALS ortam değişkeni bulunamadı.');
      process.exit(1);
    }
    apiCredentials = JSON.parse(process.env.API_CREDENTIALS);
    return true;
  } catch (error) {
    console.error(`❌ API credentials yüklenirken hata: ${error.message}`);
    process.exit(1);
  }
}

async function getAccessToken() {
  try {
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) return accessToken;
    console.log('🔑 Yeni access token alınıyor...');
    const response = await axios.post(
      'https://api.amazon.com/auth/o2/token',
      {
        grant_type: 'refresh_token',
        refresh_token: apiCredentials.eu_refresh_token,
        client_id: apiCredentials.eu_lwa_app_id,
        client_secret: apiCredentials.eu_lwa_client_secret
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REQUEST_TIMEOUT
      }
    );
    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    console.log('✅ Access token alındı');
    return accessToken;
  } catch (error) {
    console.error('❌ Access token alınırken hata:', error.response?.data || error.message);
    throw error;
  }
}

async function getGoogleSheetClient() {
    if (!process.env.GOOGLE_CREDENTIALS) {
        console.error('❌ GOOGLE_CREDENTIALS ortam değişkeni bulunamadı.');
        process.exit(1);
    }
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function fetchPriceAndRateLimit({ asin, country }) {
  const countryInfo = COUNTRIES[country];
  if (!countryInfo) throw new Error('Geçersiz ülke');
  const token = await getAccessToken();
  const url = `https://sellingpartnerapi-eu.amazon.com/products/pricing/v0/items/${asin}/offers`;
  const params = { MarketplaceId: countryInfo.marketplace_id, ItemCondition: 'New', CustomerType: 'Business' };
  try {
    const response = await axios.get(url, { params, headers: { 'Authorization': `Bearer ${token}`, 'x-amz-access-token': token, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT });
    return { data: response.data, headers: response.headers, error: null };
  } catch (error) {
    return { data: null, headers: error.response?.headers || null, error: error };
  }
}

// --- Ana Döngü ---
async function main() {
  // Durum değişkenlerini her iş başlangıcında sıfırla
  isJobRunning = true;
  isPaused = false;
  shouldStop = false;
  processedTasks = 0;
  totalTasks = 0;
  allResults = [];

  console.log('🚀 Amazon SP-API Dinamik Fiyat Alıcı Başlatılıyor...\n');
  
  try {
    const sheets = await getGoogleSheetClient();
    await getAccessToken();

    console.log(`📊 Google Sheets'ten ASIN'ler okunuyor...`);
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'EU!B2:B' });
    const sheetValues = response.data.values || [];
    if (sheetValues.length === 0) throw new Error("Google Sheet'te ASIN bulunamadı!");

    const allTasksRaw = [];
    sheetValues.forEach((row, index) => {
        const asin = row[0];
        if (asin && asin.trim() !== '') {
            const rowIndex = index + 2;
            for (const country of Object.keys(COUNTRIES)) {
                allTasksRaw.push({ asin, country, row: rowIndex });
            }
        }
    });
    totalTasks = allTasksRaw.length;
    if (totalTasks === 0) throw new Error('İşlenecek ASIN bulunamadı!');
    
    console.log(`📝 Toplam ${totalTasks} API sorgusu yapılacak.`);
    startTime = Date.now();

    const batchUpdateTimer = setInterval(() => {
        if (allResults.length > 0) {
            console.log("\n⏱️ Periyodik güncelleme yapılıyor...");
            updateGoogleSheet(sheets, [...allResults], null, false);
            allResults = [];
        }
    }, BATCH_UPDATE_INTERVAL);

    for (let i = 0; i < totalTasks; i++) {
        // --- KONTROL NOKTASI ---
        while (isPaused) {
            if (i % 10 === 0) console.log(`⏸️ İşlem duraklatıldı... (${processedTasks}/${totalTasks})`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5 saniyede bir kontrol et
        }
        if (shouldStop) {
            console.log('🛑 İşlem kullanıcı tarafından durduruldu.');
            break; // Döngüden çık
        }
        // -----------------------

        const task = allTasksRaw[i];
        let result = { ...task, price: null, moq: null, success: false, reason: '' };
        try {
            const { data, error } = await fetchPriceAndRateLimit(task);
            const statusCode = error?.response?.status;
            if (!error) {
                const offers = data?.payload?.Offers || [];
                if (offers.length > 0) {
                    result.price = parseFloat((offers[0].ListingPrice?.Amount || 0).toFixed(2));
                    result.success = true;
                    result.reason = 'Başarılı';
                } else {
                    result.reason = 'Teklif Yok';
                }
            } else {
                result.reason = `Hata: ${statusCode || error.message}`;
            }
        } catch (e) {
            result.reason = `İç Hata: ${e.message}`;
        }
        
        allResults.push(result);
        processedTasks++;
        if(i % 10 === 0) console.log(`--> İlerleme: %${Math.round((processedTasks / totalTasks) * 100)} (${processedTasks}/${totalTasks})`);
        await new Promise(resolve => setTimeout(resolve, currentDelayMs));
    }

    clearInterval(batchUpdateTimer);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const formatted = `${Math.floor(duration / 3600)}h${String(Math.floor((duration % 3600) / 60)).padStart(2, '0')}m`;
    console.log(`\n🎉 === İŞLEM TAMAMLANDI ===`);
    await updateGoogleSheet(sheets, allResults, formatted, true);

  } catch (error) {
    console.error("❌ Ana işlemde beklenmedik hata:", error);
  } finally {
    // Durum değişkenlerini her durumda sıfırla
    isJobRunning = false;
    isPaused = false;
    shouldStop = false;
    console.log("✅ İş durumu 'bitti' olarak ayarlandı.");
  }
}

// --- Google Sheets Güncelleme ---
async function updateGoogleSheet(sheets, resultsToUpdate, duration, isFinalUpdate = false) {
    try {
        if (resultsToUpdate.length === 0) return;
        console.log(`📊 ${resultsToUpdate.length} sonuç Google Sheets'e yazılıyor...`);
        if (isFinalUpdate) {
            const now = new Date();
            const headerValues = [[`DE B2B (${now.toLocaleString('tr-TR')})`, `IT B2B`, `ES B2B`, `FR B2B`]];
            await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: 'EU!D1:G1', valueInputOption: 'USER_ENTERED', resource: { values: headerValues } });
        }
        const dataForBatchUpdate = Object.values(resultsToUpdate.reduce((acc, res) => {
            if (!acc[res.row]) acc[res.row] = { range: `EU!D${res.row}:G${res.row}`, values: [[]] };
            const display = res.success ? res.price : res.reason;
            acc[res.row].values[0][Object.keys(COUNTRIES).indexOf(res.country)] = display;
            return acc;
        }, {}));
        if (dataForBatchUpdate.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { valueInputOption: 'USER_ENTERED', data: dataForBatchUpdate } });
        }
        if (isFinalUpdate && duration) {
            await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: 'EU!H1', valueInputOption: 'USER_ENTERED', resource: { values: [[`Son Çalışma: ${duration}`]] } });
        }
        console.log(`✅ Google Sheets güncellendi!`);
    } catch (error) {
        console.error('❌ Google Sheets hatası:', error.message);
    }
}

// --- WEB SUNUCUSU ---
const PORT = process.env.PORT || 3001;
loadApiCredentials(); // Sunucu başlarken credentialları yükle

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const { pathname, query } = parsedUrl;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (query.token !== process.env.TRIGGER_TOKEN && pathname !== '/') {
        res.writeHead(403).end(JSON.stringify({ success: false, message: 'Geçersiz veya eksik güvenlik tokeni.' }));
        return;
    }

    switch (pathname) {
        case '/':
            res.writeHead(200).end(JSON.stringify({ success: true, message: 'Sunucu çalışıyor.' }));
            break;
        case '/start':
            if (isJobRunning) {
                res.writeHead(429).end(JSON.stringify({ success: false, message: 'Zaten çalışan bir görev var.' }));
            } else {
                res.writeHead(200).end(JSON.stringify({ success: true, message: 'İş başarıyla başlatıldı.' }));
                main(); // Asenkron olarak başlat
            }
            break;
        case '/pause':
            if (!isJobRunning || isPaused) {
                res.writeHead(400).end(JSON.stringify({ success: false, message: 'Çalışan veya duraklatılmamış bir iş yok.' }));
            } else {
                isPaused = true;
                res.writeHead(200).end(JSON.stringify({ success: true, message: 'İş duraklatıldı.' }));
            }
            break;
        case '/resume':
            if (!isJobRunning || !isPaused) {
                res.writeHead(400).end(JSON.stringify({ success: false, message: 'Devam ettirilecek duraklatılmış bir iş yok.' }));
            } else {
                isPaused = false;
                res.writeHead(200).end(JSON.stringify({ success: true, message: 'İş devam ettiriliyor.' }));
            }
            break;
        case '/stop':
            if (!isJobRunning) {
                res.writeHead(400).end(JSON.stringify({ success: false, message: 'Durdurulacak bir iş yok.' }));
            } else {
                shouldStop = true;
                isPaused = false; // Duraklatılmışsa döngüden çıkmasını sağla
                res.writeHead(200).end(JSON.stringify({ success: true, message: 'İşin durdurulması istendi.' }));
            }
            break;
        case '/status':
            const progress = totalTasks > 0 ? Math.round((processedTasks / totalTasks) * 100) : 0;
            res.writeHead(200).end(JSON.stringify({
                success: true,
                isJobRunning,
                isPaused,
                processedTasks,
                totalTasks,
                progress: `${progress}%`
            }));
            break;
        default:
            res.writeHead(404).end(JSON.stringify({ success: false, message: 'Endpoint bulunamadı.' }));
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda başlatıldı.`);
    if (!process.env.TRIGGER_TOKEN) {
        console.warn("⚠️ UYARI: TRIGGER_TOKEN ortam değişkeni ayarlanmamış.");
    }
});