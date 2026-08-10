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

async function testStreamUrl(url, timeoutMs = 8000) {
    try {
        const response = await axios.head(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': new URL(url).origin + '/'
            },
            timeout: timeoutMs,
            maxRedirects: 5,
            validateStatus: (status) => status < 400
        });
        return response.status === 200 || response.status === 302;
    } catch (e) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': new URL(url).origin + '/'
                },
                timeout: timeoutMs,
                maxRedirects: 5,
                responseType: 'text',
                validateStatus: (status) => status < 400
            });
            return response.status === 200;
        } catch (e2) {
            return false;
        }
    }
}

async function diagnoseSite() {
    const result = {
        mainPage: { length: 0, title: '', links: [], m3u8s: [], sample: '' },
        channelPages: [],
        channels: []
    };
    
    try {
        console.log('DIAG: Requesting main page via FlareSolverr...');
        const solution = await flaresolverrGet(SITE_URL);
        const html = solution.response || '';
        result.mainPage.length = html.length;
        result.mainPage.sample = html.substring(0, 3000);
        
        const $ = cheerio.load(html);
        result.mainPage.title = $('title').text().trim();
        
        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            const text = $(el).text().trim().substring(0, 80);
            if (href && text) {
                result.mainPage.links.push({ text, href });
            }
        });
        
        const m3u8Regex = /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/g;
        result.mainPage.m3u8s = html.match(m3u8Regex) || [];
        
        const allDataAttrs = [];
        $('*').each((i, el) => {
            const attrs = el.attribs || {};
            for (const key of Object.keys(attrs)) {
                if (key.startsWith('data-') && attrs[key] && attrs[key].includes('http')) {
                    allDataAttrs.push({ attr: key, value: attrs[key].substring(0, 200), tag: el.tagName, text: $(el).text().trim().substring(0, 50) });
                }
            }
        });
        result.mainPage.dataAttrs = allDataAttrs.slice(0, 50);
        
        $('iframe').each((i, el) => {
            result.mainPage.links.push({ text: '[iframe]', href: $(el).attr('src') || '' });
        });
        
        $('video, source').each((i, el) => {
            result.mainPage.links.push({ text: '[video]', href: $(el).attr('src') || '' });
        });
        
        console.log(`DIAG: Main page has ${result.mainPage.links.length} links, ${result.mainPage.m3u8s.length} m3u8 URLs`);
        
        const channelLinks = result.mainPage.links.filter(l =>
            l.href && (
                l.href.includes('canal') ||
                l.href.includes('channel') ||
                l.href.includes('redecanaistv.capital/') ||
                (l.href.startsWith('/') && !l.href.startsWith('//'))
            ) && l.href !== '/' && l.text !== '[iframe]' && l.text !== '[video]'
        ).slice(0, 5);
        
        for (const link of channelLinks) {
            let chUrl = link.href;
            if (chUrl.startsWith('/')) chUrl = 'https://redecanaistv.capital' + chUrl;
            
            try {
                console.log(`DIAG: Checking channel page: ${chUrl}`);
                const chSolution = await flaresolverrGet(chUrl);
                const chHtml = chSolution.response || '';
                const $ch = cheerio.load(chHtml);
                
                const chM3u8s = chHtml.match(m3u8Regex) || [];
                const chDataAttrs = [];
                $ch('[data-src], [data-url], [data-video], [data-stream]').each((i, el) => {
                    chDataAttrs.push({
                        attr: Object.keys(el.attribs).find(k => k.startsWith('data-')),
                        value: Object.values(el.attribs).find(v => v && v.includes('http')) || '',
                        text: $ch(el).text().trim().substring(0, 50)
                    });
                });
                
                const iframes = [];
                $ch('iframe').each((i, el) => {
                    iframes.push($ch(el).attr('src') || '');
                });
                
                const videos = [];
                $ch('video, source').each((i, el) => {
                    videos.push($ch(el).attr('src') || '');
                });
                
                $ch('script').each((i, el) => {
                    const src = $ch(el).attr('src') || '';
                    if (src.includes('player') || src.includes('video') || src.includes('stream')) {
                        result.channelPages.push({ url: chUrl, scriptSrc: src });
                    }
                });
                
                result.channelPages.push({
                    url: chUrl,
                    title: $ch('title').text().trim(),
                    htmlLength: chHtml.length,
                    m3u8s: chM3u8s,
                    dataAttrs: chDataAttrs.slice(0, 10),
                    iframes,
                    videos,
                    sample: chHtml.substring(0, 1000)
                });
                
                console.log(`DIAG: ${chUrl} -> m3u8s: ${chM3u8s.length}, iframes: ${iframes.length}, videos: ${videos.length}`);
            } catch (e) {
                result.channelPages.push({ url: chUrl, error: e.message });
            }
        }
        
    } catch (e) {
        result.error = e.message;
    }
    
    return result;
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
        const solution = await flaresolverrGet(SITE_URL);
        const html = solution.response || '';
        const $ = cheerio.load(html);
        
        const channelLinks = [];
        $('a').each((i, el) => {
            const name = $(el).text().trim() || $(el).attr('title') || '';
            const href = $(el).attr('href') || '';
            const logo = $(el).find('img').attr('src') || '';
            if (name && name.length > 1 && name.length < 100 && href && href !== '#') {
                channelLinks.push({ name, href, logo });
            }
        });
        
        console.log(`Found ${channelLinks.length} links on main page`);
        
        for (const ch of channelLinks.slice(0, 150)) {
            let channelUrl = ch.href;
            if (channelUrl.startsWith('/')) channelUrl = 'https://redecanaistv.capital' + channelUrl;
            if (!channelUrl.startsWith('http')) continue;
            
            try {
                const chSolution = await flaresolverrGet(channelUrl);
                const chHtml = chSolution.response || '';
                
                let streamUrl = null;
                
                const m3u8Match = chHtml.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/);
                if (m3u8Match) streamUrl = m3u8Match[0];
                
                if (!streamUrl) {
                    const $ch = cheerio.load(chHtml);
                    $ch('video source, video, source').each((i, el) => {
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
                        $ch('[data-src], [data-url], [data-video], [data-stream]').each((i, el) => {
                            const src = $ch(el).attr('data-src') || $ch(el).attr('data-url') || $ch(el).attr('data-video') || $ch(el).attr('data-stream');
                            if (src && src.includes('http') && !streamUrl) streamUrl = src;
                        });
                    }
                }
                
                if (streamUrl && !seenUrls.has(streamUrl)) {
                    seenUrls.add(streamUrl);
                    channels.push({ name: ch.name, url: streamUrl, logo: ch.logo || '' });
                    console.log(`✓ ${ch.name} -> ${streamUrl.substring(0, 70)}`);
                }
            } catch (e) {
                // Skip failed channels
            }
        }
        
        console.log(`Validating ${channels.length} channels by sampling...`);
        const validatedChannels = [];
        for (const ch of channels) {
            const works = await testStreamUrl(ch.url);
            if (works) {
                validatedChannels.push(ch);
                console.log(`✓ VALID: ${ch.name}`);
            } else {
                console.log(`✗ INVALID: ${ch.name}`);
            }
        }
        
        console.log(`Validated: ${validatedChannels.length}/${channels.length} channels working`);
        
        if (validatedChannels.length > 0) {
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ channels: validatedChannels, timestamp: Date.now() }));
            return validatedChannels;
        }
        
        if (channels.length > 0) {
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ channels, timestamp: Date.now() }));
            return channels;
        }
        
        return [];
    } catch (e) {
        console.error('Scraper error:', e.message);
        if (fs.existsSync(CACHE_FILE)) {
            const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            if (cached.channels?.length > 0) return cached.channels;
        }
        return [];
    }
}

module.exports = { scrapeRedeCanais, diagnoseSite, testStreamUrl };