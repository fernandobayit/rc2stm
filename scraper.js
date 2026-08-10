const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SITE_URL = 'https://redecanaistv.capital/';
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191/v1';
const CACHE_FILE = path.join(__dirname, 'channels_cache.json');
const CACHE_TTL = 60 * 60 * 1000;

async function flaresolverrGet(url) {
    const response = await axios.post(FLARESOLVERR_URL, {
        cmd: 'request.get',
        url: url,
        maxTimeout: 60000
    }, { timeout: 70000 });
    
    if (response.data && response.data.solution) {
        return response.data.solution;
    }
    throw new Error('FlareSolverr: no solution returned');
}

async function scrapeRedeCanais() {
    if (fs.existsSync(CACHE_FILE)) {
        const stats = fs.statSync(CACHE_FILE);
        if (Date.now() - stats.mtimeMs < CACHE_TTL) {
            const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            if (cached.channels?.length > 0) return cached.channels;
        }
    }

    console.log('Starting scraper via FlareSolverr...');
    const channels = [];
    const seenUrls = new Set();

    try {
        console.log('Requesting main page via FlareSolverr...');
        const solution = await flaresolverrGet(SITE_URL);
        const html = solution.response || '';
        console.log('FlareSolverr returned page, length:', html.length);
        
        const $ = cheerio.load(html);
        
        const channelLinks = [];
        $('a, button, [role=button], .channel, .canal').each((i, el) => {
            const name = $(el).text().trim() || $(el).attr('data-name') || $(el).attr('title') || '';
            const href = $(el).attr('href') || $(el).attr('data-url') || '';
            const logo = $(el).find('img').attr('src') || $(el).attr('data-logo') || '';
            if (name && name.length > 1 && name.length < 100 && href) {
                channelLinks.push({ name, href, logo });
            }
        });
        
        console.log(`Found ${channelLinks.length} channel links on main page`);
        
        for (const ch of channelLinks.slice(0, 100)) {
            let channelUrl = ch.href;
            if (channelUrl.startsWith('/')) channelUrl = 'https://redecanaistv.capital' + channelUrl;
            if (!channelUrl.startsWith('http')) continue;
            
            try {
                console.log(`Checking: ${ch.name}`);
                const chSolution = await flaresolverrGet(channelUrl);
                const chHtml = chSolution.response || '';
                const $ch = cheerio.load(chHtml);
                
                let streamUrl = null;
                
                $ch('video source, video').each((i, el) => {
                    const src = $ch(el).attr('src');
                    if (src && !streamUrl) streamUrl = src;
                });
                
                if (!streamUrl) {
                    $ch('iframe').each((i, el) => {
                        const src = $ch(el).attr('src');
                        if (src && !streamUrl) streamUrl = src;
                    });
                }
                
                if (!streamUrl) {
                    const m3u8Match = chHtml.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
                    if (m3u8Match) streamUrl = m3u8Match[0];
                }
                
                if (!streamUrl) {
                    $ch('[data-src], [data-url], [data-video]').each((i, el) => {
                        const src = $ch(el).attr('data-src') || $ch(el).attr('data-url') || $ch(el).attr('data-video');
                        if (src && src.includes('m3u8') && !streamUrl) streamUrl = src;
                    });
                }
                
                if (streamUrl && !seenUrls.has(streamUrl)) {
                    seenUrls.add(streamUrl);
                    channels.push({ name: ch.name, url: streamUrl, logo: ch.logo || '' });
                    console.log(`✓ ${ch.name} -> ${streamUrl.substring(0, 70)}`);
                }
            } catch (e) {
                console.error(`✗ ${ch.name} - ${e.message}`);
            }
        }
        
        const m3u8Regex = /https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g;
        const mainM3u8s = html.match(m3u8Regex) || [];
        for (const url of mainM3u8s) {
            if (!seenUrls.has(url)) {
                seenUrls.add(url);
                channels.push({ name: `Channel ${channels.length + 1}`, url, logo: '' });
            }
        }
        
        console.log(`Scraper found ${channels.length} channels total`);
        
        if (channels.length > 0) {
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ channels, timestamp: Date.now() }));
        }
        
        return channels;
    } catch (e) {
        console.error('Scraper error:', e.message);
        if (fs.existsSync(CACHE_FILE)) {
            const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            if (cached.channels?.length > 0) return cached.channels;
        }
        return [];
    }
}

module.exports = { scrapeRedeCanais };