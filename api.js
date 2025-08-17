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

// --- Global Değişkenler ---
let apiCredentials = null;
let accessToken = null;
let tokenExpiry = null;
let allResults = [];
let startTime = Date.now();
let currentDelayMs = 1900;
let isJobRunning = false; // Aynı anda tek bir işin çalışmasını sağlamak için

// --- Yardımcı Fonksiyonlar ---
function loadApiCredentials() {
  try {
    if (!process.env.API_CREDENTIALS) {
      console.error('❌ API_CREDENTIALS ortam değişkeni bulunamadı.');
      console.error('Bu değişken, api_credentials.json dosyasının içeriğini barındırmalıdır.');
      process.exit(1);
    }
    apiCredentials = JSON.parse(process.env.API_CREDENTIALS);
    console.log('✅ API credentials ortam değişkeninden yüklendi');
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
        console.error('Bu değişken, Google Cloud credentials.json dosyasının içeriğini barındırmalıdır.');
        process.exit(1);
    }
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// --- Fiyat Alma Fonksiyonu ---
async function fetchPriceAndRateLimit({ asin, country }) {
  // ... (Bu fonksiyonun içeriği değişmedi)
  const countryInfo = COUNTRIES[country];
  if (!countryInfo) throw new Error('Geçersiz ülke');

  const token = await getAccessToken();
  const url = `https://sellingpartnerapi-eu.amazon.com/products/pricing/v0/items/${asin}/offers`;
  const params = {
    MarketplaceId: countryInfo.marketplace_id,
    ItemCondition: 'New',
    CustomerType: 'Business'
  };

  try {
    const response = await axios.get(url, {
      params,
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-amz-access-token': token,
        'Content-Type': 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    });
    return { data: response.data, headers: response.headers, error: null };
  } catch (error) {
    return { data: null, headers: error.response?.headers || null, error: error };
  }
}

// --- Ana Döngü ---
async function main() {
  if (isJobRunning) {
    console.log("ℹ️ Zaten çalışan bir iş var. Yeni iş başlatılmadı.");
    return;
  }

  isJobRunning = true;
  console.log('🚀 Amazon SP-API Dinamik Fiyat Alıcı Başlatılıyor...\n');
  
  try {
    loadApiCredentials();
    const sheets = await getGoogleSheetClient();
    await getAccessToken();

    console.log(`📊 Google Sheets'ten ASIN'ler ve satır numaraları okunuyor...`);
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'EU!B2:B' });
    const sheetValues = response.data.values || [];
    if (sheetValues.length === 0) {
        console.log('❌ ASIN bulunamadı!');
        return;
    }

    const allTasks = [];
    sheetValues.forEach((row, index) => {
        const asin = row[0];
        if (asin && asin.trim() !== '') {
            const rowIndex = index + 2;
            for (const country of Object.keys(COUNTRIES)) {
                allTasks.push({ asin, country, row: rowIndex });
            }
        }
    });

    if (allTasks.length === 0) {
        console.log('❌ İşlenecek ASIN bulunamadı!');
        return;
    }
    
    const uniqueAsinCount = new Set(allTasks.map(t => t.asin)).size;
    console.log(`📝 ${uniqueAsinCount} ASIN ve ${Object.keys(COUNTRIES).length} ülke için toplam ${allTasks.length} API sorgusu yapılacak.`);
    startTime = Date.now();
    allResults = []; // Her iş başlangıcında sonuçları sıfırla

    const batchUpdateTimer = setInterval(() => {
        if (allResults.length > 0) {
            console.log("\n⏱️ Periyodik güncelleme yapılıyor...");
            updateGoogleSheet(sheets, [...allResults], null, false);
            allResults = []; // Periyodik güncelleme sonrası temizle
        }
    }, BATCH_UPDATE_INTERVAL);

    for (let i = 0; i < allTasks.length; i++) {
        const task = allTasks[i];
        // ... (for döngüsünün geri kalanı değişmedi)
        let attempt = 0;
        let data = null;
        let headers = null;
        let error = null;
      
        while (attempt < 4) {
            ({ data, headers, error } = await fetchPriceAndRateLimit(task));
            const statusCode = error?.response?.status;
          
            if (statusCode === 429 && attempt === 0) {
              console.warn(`[${task.asin} - ${task.country}] ⚠️ 429 alındı, 0.2 saniye sonra tekrar denenecek...`);
              attempt++;
              await new Promise(resolve => setTimeout(resolve, 200));
              continue;
            }
            break;
          }
      
        let result = { ...task, price: null, moq: null, success: false, reason: '' };
        const statusCode = error?.response?.status;
      
        if (!error) {
          const offers = data?.payload?.Offers || [];
          if (offers.length === 0) {
            result.reason = 'Teklif Yok';
            console.log(`[${task.asin} - ${task.country}] ℹ️ Teklif Yok`);
          } else {
            let bestPrice = Infinity, bestMoq = 1;
            for (const offer of offers) {
              const listingPrice = parseFloat(offer.ListingPrice?.Amount || Infinity);
              if (listingPrice < bestPrice) {
                bestPrice = listingPrice;
                bestMoq = 1;
              }
            }
            if (bestPrice !== Infinity) {
              result.price = parseFloat(bestPrice.toFixed(2));
              result.moq = bestMoq;
              result.success = true;
              result.reason = 'Başarılı';
              console.log(`[${task.asin} - ${task.country}] ✅ B2B: €${result.price} (MOQ: ${result.moq})`);
            } else {
              result.reason = 'Geçerli Fiyat Yok';
            }
          }
        } else if (statusCode === 400) {
          result.reason = 'Teklif Yok (400)';
          console.log(`[${task.asin} - ${task.country}] ℹ️ Teklif Yok (400)`);
        } else if (statusCode === 429) {
          result.reason = 'Rate Limit (429)';
          console.error(`[${task.asin} - ${task.country}] 🚦 Rate Limit (429)`);
        } else {
          result.reason = `Hata: ${statusCode || error.message}`;
          console.error(`[${task.asin} - ${task.country}] ❌ ${result.reason}`);
        }
      
        allResults.push(result);
      
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const progress = Math.round(((i + 1) / allTasks.length) * 100);
        console.log(`--> İlerleme: %${progress} (${i + 1}/${allTasks.length}) | Süre: ${elapsed}s | Sonraki istek için bekleme: ${Math.round(currentDelayMs)}ms`);
      
        if (i < allTasks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, currentDelayMs));
        }
    }

    clearInterval(batchUpdateTimer);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const formatted = `${Math.floor(duration / 3600)}:${String(Math.floor((duration % 3600) / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;
    console.log(`\n🎉 === İŞLEM TAMAMLANDI ===`);
    await updateGoogleSheet(sheets, allResults, formatted, true);

  } catch (error) {
    console.error("❌ Ana işlemde beklenmedik hata:", error);
  } finally {
    isJobRunning = false;
    console.log("✅ İş durumu 'bitti' olarak ayarlandı.");
  }
}

// --- Google Sheets Güncelleme ---
async function updateGoogleSheet(sheets, resultsToUpdate, duration, isFinalUpdate = false) {
    // ... (Bu fonksiyonun içeriği değişmedi)
    try {
        if (resultsToUpdate.length === 0) {
            if (isFinalUpdate) console.log("📊 Güncellenecek yeni veri yok.");
            return;
        }
        console.log(`📊 ${resultsToUpdate.length} sonuç Google Sheets'e yazılıyor...`);

        if (isFinalUpdate) {
            const now = new Date();
            const headerValues = [[ 
                `DE B2B (${now.toLocaleString('tr-TR')})`,
                `IT B2B (${now.toLocaleString('tr-TR')})`,
                `ES B2B (${now.toLocaleString('tr-TR')})`,
                `FR B2B (${now.toLocaleString('tr-TR')})`
            ]];
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: 'EU!D1:G1',
                valueInputOption: 'USER_ENTERED',
                resource: { values: headerValues }
            });
        }

        const resultsByRow = {};
        resultsToUpdate.forEach(res => {
            if (!res || !res.row) return;
            if (!resultsByRow[res.row]) {
                resultsByRow[res.row] = { 'DE': '', 'IT': '', 'ES': '', 'FR': '' };
            }
            const display = res.success && typeof res.price === 'number'
                ? res.price
                : (res.reason || 'Hata');
            resultsByRow[res.row][res.country] = display;
        });

        const dataForBatchUpdate = Object.keys(resultsByRow).map(row => {
            const rowData = resultsByRow[row];
            const orderedValues = Object.keys(COUNTRIES).map(country => rowData[country] || '');
            return {
                range: `EU!D${row}:G${row}`,
                values: [orderedValues]
            };
        });

        if (dataForBatchUpdate.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: dataForBatchUpdate
                }
            });
        }

        if (isFinalUpdate && duration) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: 'EU!H1',
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[`Son Çalışma: ${duration}`]] }
            });
        }

        console.log(`✅ Google Sheets güncellendi! (${dataForBatchUpdate.length} satır işlendi)`);
        
    } catch (error) {
        console.error('❌ Google Sheets hatası:', error.message, error.stack);
    }
}

// --- WEB SUNUCUSU ---
const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const { pathname, query } = parsedUrl;

    if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Sunucu çalışıyor. Tetiklemek için /start endpointini kullanın.');
        return;
    }

    if (pathname === '/start') {
        if (query.token !== process.env.TRIGGER_TOKEN) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Geçersiz veya eksik güvenlik tokeni.');
            return;
        }

        if (isJobRunning) {
            res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Zaten çalışan bir görev var. Lütfen mevcut görevin bitmesini bekleyin.');
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('İş başarıyla başlatıldı. Logları Railway arayüzünden takip edebilirsiniz.');

        // İsteği sonlandırdıktan sonra ana işi asenkron olarak başlat
        main().catch(err => console.error("Main fonksiyonunda yakalanamayan hata:", err));

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Endpoint bulunamadı.');
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda başlatıldı.`);
    if (!process.env.TRIGGER_TOKEN) {
        console.warn("⚠️ UYARI: TRIGGER_TOKEN ortam değişkeni ayarlanmamış. Sunucu güvensiz modda çalışıyor.");
    }
});
