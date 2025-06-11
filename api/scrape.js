// 📄 api/scrape.js
import { chromium } from 'playwright-chromium';

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { address, chain = 'sonic' } = req.query;
    
    if (!address) {
        return res.status(400).json({ 
            error: 'Address parameter required',
            usage: '/api/scrape?address=0x123...&chain=sonic'
        });
    }
    
    let browser = null;
    
    try {
        console.log(`🔍 Scraping ${address} on ${chain}...`);
        
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        const data = {};
        
        // Intercepter les réponses API
        page.on('response', async (response) => {
            if (response.url().includes('api.debank.com') && response.status() === 200) {
                try {
                    const json = await response.json();
                    const url = response.url();
                    
                    if (url.includes('total_net_curve')) {
                        data.net_curve = json;
                        console.log('✅ Got net_curve');
                    } else if (url.includes('used_chains')) {
                        data.chains = json;
                        console.log('✅ Got chains');
                    } else if (url.includes('project_list')) {
                        data.projects = json;
                        console.log('✅ Got projects');
                    } else if (url.includes('balance_list')) {
                        data.balances = json;
                        console.log('✅ Got balances');
                    }
                } catch (e) {
                    console.log('⚠️ JSON parse error:', e.message);
                }
            }
        });
        
        // Naviguer vers la page
        await page.goto(`https://debank.com/profile/${address}?chain=${chain}`, {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        // Attendre les données
        await page.waitForTimeout(8000);
        
        // Calculer les résumés
        const summary = {
            total_value: 0,
            wallet_value: 0,
            defi_value: 0,
            token_count: 0,
            last_update: new Date().toISOString(),
            chain
        };
        
        // Calculer valeur du wallet
        if (data.balances?.data) {
            summary.wallet_value = data.balances.data.reduce(
                (sum, token) => sum + (token.amount * token.price), 0
            );
            summary.token_count = data.balances.data.length;
        }
        
        // Calculer valeur DeFi
        if (data.projects?.data) {
            summary.defi_value = data.projects.data.reduce((sum, project) => 
                sum + project.portfolio_item_list.reduce(
                    (pSum, item) => pSum + (item.stats?.net_usd_value || 0), 0
                ), 0
            );
        }
        
        summary.total_value = summary.wallet_value + summary.defi_value;
        
        console.log(`💰 Total value: $${summary.total_value.toFixed(2)}`);
        
        res.status(200).json({
            success: true,
            address: address.toLowerCase(),
            summary,
            raw_data: data,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('❌ Scraping error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: Date.now()
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}
