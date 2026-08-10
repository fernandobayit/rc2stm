const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://redecanaistv.capital/';
const CACHE_FILE = path.join(__dirname, 'channels_cache.json');
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function scrapeRedeCanais() {
    // Check cache first
    if (fs.existsSync(CACHE_FILE)) {
        const stats = fs.statSync(CACHE_FILE);
        if (Date.now() - stats.mtimeMs < CACHE_TTL) {
            const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            if (cached.channels && cached.channels.length > 0) {
                console.log(`Using cached channels: ${cached.channels.length} channels`);
                return cached.channels;
            }
        }
    }

    console.log('Starting scraper for redecanaistv.capital...');
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        
        console.log('Navigating to redecanaistv.capital...');
        await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Wait for Cloudflare to pass (up to 60 seconds)
        console.log('Waiting for Cloudflare verification...');
        for (let i = 0; i < 30; i++) {
            await page.waitForTimeout(2000);
            const title = await page.title();
            if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
                console.log('Cloudflare passed! Page title:', title);
                break;
            }
            console.log(`Waiting... (${i+1}/30) title: ${title}`);
        }
        
        await page.waitForTimeout(3000);
        
        // Intercept network requests for m3u8 streams
        const channels = [];
        const seenUrls = new Set();
        
        // Listen for m3u8 URLs in network traffic
        page.on('response', response => {
            const url = response.url();
            if (url.includes('.m3u8')) {
                if (!seenUrls.has(url)) {
                    seenUrls.add(url);
                    channels.push({ name: '', url, logo: '' });
                }
            }
        });
        
        // Extract channel data from page DOM
        const channelData = await page.evaluate(() => {
            const channels = [];
            document.querySelectorAll('a[href], button[data-url], div[data-url], [data-channel], .channel, .canal').forEach(el => {
                const name = el.textContent?.trim() || el.getAttribute('data-name') || el.getAttribute('title') || '';
                const url = el.getAttribute('data-url') || el.getAttribute('href') || '';
                const logo = el.getAttribute('data-logo') || el.querySelector('img')?.src || '';
                if (name && name.length > 1 && name.length < 100) {
                    channels.push({ name, url, logo });
                }
            });
            return channels;
        });
        
        // Click through channel links to capture stream URLs
        const allLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a, button, [role="button"]')).map(el => ({
                text: el.textContent?.trim().substring(0, 50),
                href: el.href || el.getAttribute('data-url') || '',
                tag: el.tagName
            })).filter(l => l.text && l.text.length > 1);
        });
        
        console.log(`Found ${allLinks.length} clickable elements`);
        
        for (const link of allLinks.slice(0, 50)) {
            if (link.href && (link.href.includes('canal') || link.href.includes('channel') || link.href.includes('redecanaistv'))) {
                try {
                    await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForTimeout(2000);
                    
                    const videoSrc = await page.evaluate(() => {
                        const video = document.querySelector('video');
                        if (video && video.src) return video.src;
                        const source = document.querySelector('source');
                        if (source && source.src) return source.src;
                        const iframe = document.querySelector('iframe');
                        if (iframe && iframe.src) return iframe.src;
                        return null;
                    });
                    
                    if (videoSrc) {
                        channels.push({ name: link.text, url: videoSrc, logo: '' });
                        console.log(`Found: ${link.text} -> ${videoSrc.substring(0, 60)}`);
                    }
                } catch(e) {}
            }
        }
        
        // Add channels from DOM data
        for (const ch of channelData) {
            if (ch.url && ch.url.startsWith('http') && !seenUrls.has(ch.url)) {
                seenUrls.add(ch.url);
                channels.push({ name: ch.name, url: ch.url, logo: ch.logo || '' });
            }
        }
        
        console.log(`Scraper found ${channels.length} channels`);
        
        if (channels.length > 0) {
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ channels, timestamp: Date.now() }));
        }
        
        await browser.close();
        return channels;
        
    } catch (e) {
        console.error('Scraper error:', e.message);
        if (browser) await browser.close();
        if (fs.existsSync(CACHE_FILE)) {
            const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            if (cached.channels?.length > 0) return cached.channels;
        }
        return [];
    }
}

module.exports = { scrapeRedeCanais };