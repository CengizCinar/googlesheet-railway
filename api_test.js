// debug_test.js - Hızlı test için
const { google } = require('googleapis');
const fs = require('fs');

const SPREADSHEET_ID = '1OOc9on8hfMkf9aZJuDZKX_UsiH2EjbZEQYbwexr5Uds';
const CREDENTIALS_PATH = 'credentials.json';

async function quickDebug() {
    try {
        console.log('🔍 Debug Test Başlatılıyor...');
        
        // 1. Credentials kontrol
        console.log('📋 Credentials kontrol...');
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            console.error('❌ credentials.json bulunamadı');
            return;
        }
        console.log('✅ Credentials dosyası mevcut');
        
        // 2. Google Sheets bağlantı
        console.log('📊 Google Sheets bağlantısı test ediliyor...');
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        console.log('✅ Google Sheets bağlandı');
        
        // 3. Sheet bilgilerini al
        console.log('📄 Sheet metadata alınıyor...');
        const sheetInfo = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });
        console.log(`📋 Sheet adı: ${sheetInfo.data.properties.title}`);
        console.log(`📊 Sheet sayısı: ${sheetInfo.data.sheets.length}`);
        
        // 4. İlk sheet'in adını al
        const firstSheetTitle = sheetInfo.data.sheets[0].properties.title;
        console.log(`📑 İlk sheet: ${firstSheetTitle}`);
        
        // 5. A sütununu oku (birkaç farklı yöntemle)
        console.log('\n🔍 A sütunu test ediliyor...');
        
        // Test 1: A1:A10
        try {
            const test1 = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'A1:A10',
            });
            console.log('✅ A1:A10 başarılı:', test1.data.values?.length || 0, 'satır');
            if (test1.data.values) {
                console.log('📋 İlk 5 satır:', test1.data.values.slice(0, 5).flat());
            }
        } catch (error) {
            console.log('❌ A1:A10 hatası:', error.message);
        }
        
        // Test 2: A2:A100  
        try {
            const test2 = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'A2:A100',
            });
            console.log('✅ A2:A100 başarılı:', test2.data.values?.length || 0, 'satır');
            if (test2.data.values) {
                console.log('📋 İlk 5 ASIN:', test2.data.values.slice(0, 5).flat());
            }
        } catch (error) {
            console.log('❌ A2:A100 hatası:', error.message);
        }
        
        // Test 3: İlk sheet adıyla
        try {
            const test3 = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${firstSheetTitle}!A2:A100`,
            });
            console.log(`✅ ${firstSheetTitle}!A2:A100 başarılı:`, test3.data.values?.length || 0, 'satır');
        } catch (error) {
            console.log(`❌ ${firstSheetTitle}!A2:A100 hatası:`, error.message);
        }
        
        console.log('\n🎉 Debug test tamamlandı!');
        
    } catch (error) {
        console.error('❌ Debug test hatası:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

quickDebug();