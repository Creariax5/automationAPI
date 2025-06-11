// 📄 api/scrape.js
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!req.query.address) return res.status(400).json({ error: 'Address required' });
    
    const { address } = req.query;
    
    try {
        console.log(`Scraping DeBank profile for address: ${address}`);
        console.log(`Browserless token exists: ${!!process.env.BROWSERLESS_TOKEN}`);
        console.log(`Token length: ${process.env.BROWSERLESS_TOKEN?.length || 0}`);
        
        // Si pas de token Browserless valide, utilisez les méthodes gratuites
        if (!process.env.BROWSERLESS_TOKEN || process.env.BROWSERLESS_TOKEN.length < 10) {
            console.log('No valid Browserless token, trying free alternatives...');
            
            // Alternative 1: Scrape.do (gratuit avec limite)
            try {
                const scrapeResponse = await fetch('https://api.scrape.do', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: `https://debank.com/profile/${address}`,
                        render: true,
                        format: 'json'
                    })
                });
                
                if (scrapeResponse.ok) {
                    const data = await scrapeResponse.json();
                    return res.json({
                        success: true,
                        method: 'scrape.do',
                        address,
                        html_length: data.html?.length || 0,
                        summary: { total_value: 0, wallet_value: 0, defi_value: 0, token_count: 0 },
                        note: 'Free service used, limited data extraction'
                    });
                }
            } catch (e) {
                console.log('Scrape.do failed:', e.message);
            }
            
            // Alternative 2: Proxy simple
            try {
                const proxyResponse = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://debank.com/profile/${address}`)}`);
                
                if (proxyResponse.ok) {
                    const data = await proxyResponse.json();
                    return res.json({
                        success: true,
                        method: 'proxy',
                        address,
                        html_length: data.contents?.length || 0,
                        summary: { total_value: 0, wallet_value: 0, defi_value: 0, token_count: 0 },
                        note: 'Proxy used, basic HTML only'
                    });
                }
            } catch (e) {
                console.log('Proxy failed:', e.message);
            }
            
            return res.json({
                success: false,
                error: 'No valid Browserless token and free alternatives failed',
                suggestion: 'Get free token at https://browserless.io (1000 req/month)'
            });
        }
        
        // Si token Browserless existe, l'utiliser
        const response = await fetch(`https://production-sfo.browserless.io/function?token=${process.env.BROWSERLESS_TOKEN}`, {
            method: "POST",
            headers: {
                "Cache-Control": "no-cache",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                code: `
                export default async ({ page }) => {
                    const data = {};
                    
                    page.on('response', async (response) => {
                        if (response.url().includes('api.debank.com') && response.status() === 200) {
                            try {
                                const json = await response.json();
                                const url = response.url();
                                
                                if (url.includes('total_net_curve')) data.net_curve = json;
                                else if (url.includes('used_chains')) data.chains = json;
                                else if (url.includes('project_list')) data.projects = json;
                                else if (url.includes('balance_list')) {
                                    if (!data.balances) data.balances = { data: [] };
                                    if (json.data) {
                                        const existing = new Set(data.balances.data.map(t => t.chain + '_' + t.id));
                                        json.data.forEach(token => {
                                            const id = token.chain + '_' + token.id;
                                            if (!existing.has(id)) {
                                                data.balances.data.push(token);
                                                existing.add(id);
                                            }
                                        });
                                    }
                                }
                            } catch (e) {
                                console.log('Error parsing response:', e.message);
                            }
                        }
                    });
                    
                    try {
                        await page.goto('https://debank.com/profile/${address}', {
                            waitUntil: 'networkidle2',
                            timeout: 30000
                        });
                        
                        // Wait for content to load
                        await page.waitForTimeout(8000);
                        
                        // Try to wait for specific elements
                        try {
                            await page.waitForSelector('[data-testid="total-balance"], .HeaderInfo_totalAssets, .total-assets', {
                                timeout: 5000
                            });
                        } catch (e) {
                            console.log('Could not find balance elements, continuing...');
                        }
                    } catch (e) {
                        console.log('Error navigating to page:', e.message);
                    }
                    
                    const walletValue = data.balances?.data?.reduce((sum, token) => 
                        sum + (token.amount * token.price), 0) || 0;
                    
                    const defiValue = data.projects?.data?.reduce((sum, project) => 
                        sum + project.portfolio_item_list.reduce((pSum, item) => 
                            pSum + (item.stats?.net_usd_value || 0), 0), 0) || 0;
                    
                    return {
                        success: true,
                        method: 'browserless',
                        address: '${address}',
                        summary: {
                            total_value: walletValue + defiValue,
                            wallet_value: walletValue,
                            defi_value: defiValue,
                            token_count: data.balances?.data?.length || 0
                        },
                        balances: data.balances,
                        projects: data.projects,
                        net_curve: data.net_curve,
                        chains: data.chains,
                        captured_responses: Object.keys(data).length
                    };
                };
                `
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Browserless error: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        res.json(result);
        
    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            token_length: process.env.BROWSERLESS_TOKEN?.length || 0
        });
    }
}