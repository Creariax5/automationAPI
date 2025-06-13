// 📄 api/webhook.js - Claude-compatible webhook endpoint
export default async function handler(req, res) {
    // CORS headers for Claude
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Accept both GET and POST for flexibility
    let address;
    if (req.method === 'GET') {
        address = req.query.address;
    } else if (req.method === 'POST') {
        address = req.body?.address;
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    if (!address) {
        return res.status(400).json({ 
            error: 'Address required', 
            usage: 'GET: ?address=0x... or POST: {"address": "0x..."}'
        });
    }
    
    try {
        console.log(`🔍 Scraping DeBank profile for: ${address}`);
        console.log(`🔑 Browserless token: ${!!process.env.BROWSERLESS_TOKEN ? 'Available' : 'Missing'}`);
        
        // If no valid Browserless token, try free alternatives
        if (!process.env.BROWSERLESS_TOKEN || process.env.BROWSERLESS_TOKEN.length < 10) {
            console.log('⚠️ No valid Browserless token, trying free alternatives...');
            
            // Alternative 1: Scrape.do (free with limits)
            try {
                console.log('🌐 Trying Scrape.do...');
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
                        summary: { 
                            total_value: 0, 
                            wallet_value: 0, 
                            defi_value: 0, 
                            token_count: 0 
                        },
                        note: '🆓 Free service used - limited data extraction',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (e) {
                console.log('❌ Scrape.do failed:', e.message);
            }
            
            // Alternative 2: Simple proxy
            try {
                console.log('🔄 Trying proxy method...');
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://debank.com/profile/${address}`)}`;
                const proxyResponse = await fetch(proxyUrl);
                
                if (proxyResponse.ok) {
                    const data = await proxyResponse.json();
                    return res.json({
                        success: true,
                        method: 'proxy',
                        address,
                        html_length: data.contents?.length || 0,
                        summary: { 
                            total_value: 0, 
                            wallet_value: 0, 
                            defi_value: 0, 
                            token_count: 0 
                        },
                        note: '🔄 Proxy used - basic HTML only',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (e) {
                console.log('❌ Proxy failed:', e.message);
            }
            
            return res.status(503).json({
                success: false,
                error: 'No valid Browserless token and free alternatives failed',
                suggestion: '💡 Get free token at https://browserless.io (1000 requests/month)',
                help: 'Add BROWSERLESS_TOKEN to your Vercel environment variables'
            });
        }
        
        // Use Browserless with full scraping capability
        console.log('🚀 Using Browserless for full scraping...');
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
                    
                    // Intercept API responses
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
                            timeout: 5000
                        });
                        
                        // Wait for content to load
                        await page.waitForTimeout(4000);
                        
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
                    
                    // Calculate values
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
                            total_value: Math.round((walletValue + defiValue) * 100) / 100,
                            wallet_value: Math.round(walletValue * 100) / 100,
                            defi_value: Math.round(defiValue * 100) / 100,
                            token_count: data.balances?.data?.length || 0,
                            project_count: data.projects?.data?.length || 0
                        },
                        balances: data.balances,
                        projects: data.projects,
                        net_curve: data.net_curve,
                        chains: data.chains,
                        captured_responses: Object.keys(data).length,
                        timestamp: new Date().toISOString()
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
        console.log(`✅ Scraping completed successfully for ${address}`);
        res.json(result);
        
    } catch (error) {
        console.error('❌ Scraping error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            address,
            timestamp: new Date().toISOString(),
            token_available: !!process.env.BROWSERLESS_TOKEN
        });
    }
}
