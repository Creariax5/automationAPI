// 📄 api/scrape.js
import { chromium } from 'playwright-chromium';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!req.query.address) return res.status(400).json({ error: 'Address required' });
    
    let browser = null;
    
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        const data = {};
        
        page.on('response', async (response) => {
            if (!response.url().includes('api.debank.com') || response.status() !== 200) return;
            
            try {
                const json = await response.json();
                const url = response.url();
                
                if (url.includes('total_net_curve')) data.net_curve = json;
                else if (url.includes('used_chains')) data.chains = json;
                else if (url.includes('desc_dict')) data.desc = json;
                else if (url.includes('project_list')) data.projects = json;
                else if (url.includes('balance_list')) {
                    if (!data.balances) data.balances = { data: [] };
                    if (json.data) {
                        const existing = new Set(data.balances.data.map(t => `${t.chain}_${t.id}`));
                        json.data.forEach(token => {
                            const id = `${token.chain}_${token.id}`;
                            if (!existing.has(id)) {
                                data.balances.data.push(token);
                                existing.add(id);
                            }
                        });
                    }
                }
            } catch (e) {}
        });
        
        await page.goto(`https://debank.com/profile/${req.query.address}`);
        await page.waitForTimeout(5000);
        
        const walletValue = data.balances?.data?.reduce((sum, token) => 
            sum + (token.amount * token.price), 0) || 0;
        
        const defiValue = data.projects?.data?.reduce((sum, project) => 
            sum + project.portfolio_item_list.reduce((pSum, item) => 
                pSum + (item.stats?.net_usd_value || 0), 0), 0) || 0;
        
        const summary = {
            total_value: walletValue + defiValue,
            wallet_value: walletValue,
            defi_value: defiValue,
            token_count: data.balances?.data?.length || 0,
            last_update: new Date().toISOString()
        };
        
        res.json({
            success: true,
            address: req.query.address.toLowerCase(),
            summary,
            ...data,
            timestamp: Date.now()
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
}
