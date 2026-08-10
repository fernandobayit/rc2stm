const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const { scrapeRedeCanais } = require('./scraper');

const manifest = {
    id: 'org.rc2stm.addon',
    version: '2.1.0',
    name: 'RedeCanais TV',
    description: 'Live Brazilian TV channels scraped from redecanaistv.capital',
    resources: ['catalog', 'meta', 'stream'],
    types: ['channel'],
    catalogs: [
        { type: 'channel', id: 'rc2stm_channels', name: 'RedeCanais TV Channels' }
    ],
};

const builder = new addonBuilder(manifest);
const FALLBACK_M3U_URL = 'https://iptv-org.github.io/iptv/countries/br.m3u';

let channelsCache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

async function getChannels() {
    if (channelsCache && (Date.now() - cacheTime) < CACHE_TTL) return channelsCache;
    
    try {
        console.log('Scraping redecanaistv.capital...');
        const scraped = await scrapeRedeCanais();
        if (scraped && scraped.length > 0) {
            channelsCache = scraped.map(c => ({
                id: c.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_@.]/g, ''),
                name: c.name, url: c.url, logo: c.logo || '', group: c.group || ''
            }));
            cacheTime = Date.now();
            console.log(`Scraper: ${channelsCache.length} channels`);
            return channelsCache;
        }
    } catch (e) { console.error('Scraper failed:', e.message); }
    
    console.log('Fallback: iptv-org...');
    try {
        const response = await axios.get(FALLBACK_M3U_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
        const lines = response.data.split('\n');
        const channels = [];
        const seen = new Set();
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXTINF')) {
                const line = lines[i];
                const tvgId = (line.match(/tvg-id="([^"]*)"/)||[])[1] || '';
                const tvgLogo = (line.match(/tvg-logo="([^"]*)"/)||[])[1] || '';
                const group = (line.match(/group-title="([^"]*)"/)||[])[1] || '';
                const name = line.split(',').pop().trim();
                const url = lines[i+1] ? lines[i+1].trim() : null;
                if (url && url.startsWith('http') && name) {
                    const id = tvgId || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_@.]/g, '');
                    if (!seen.has(id)) { seen.add(id); channels.push({ id, name, url, logo: tvgLogo, group }); }
                }
            }
        }
        channelsCache = channels; cacheTime = Date.now();
        return channels;
    } catch (e) { console.error('Fallback failed:', e.message); return []; }
}

builder.defineMetaHandler(async (args) => {
    if (args.type === 'channel') {
        const channels = await getChannels();
        const channel = channels.find(c => c.id === args.id);
        if (channel) return { meta: { id: channel.id, type: 'channel', name: channel.name, poster: channel.logo || undefined, logo: channel.logo || undefined, description: `Canal: ${channel.name}${channel.group ? ' | ' + channel.group : ''}`, genres: channel.group ? [channel.group] : [] } };
    }
    return { meta: null };
});

builder.defineCatalogHandler(async (args) => {
    if (args.id === 'rc2stm_channels') {
        const channels = await getChannels();
        return { metas: channels.map(c => ({ id: c.id, type: 'channel', name: c.name, poster: c.logo || undefined, logo: c.logo || undefined })) };
    }
    return { metas: [] };
});

builder.defineStreamHandler(async (args) => {
    if (args.type === 'channel') {
        const channels = await getChannels();
        const channel = channels.find(c => c.id === args.id);
        if (channel) {
            const proxyUrl = `http://localhost:${process.env.PORT || 8000}/proxy?url=${encodeURIComponent(channel.url)}`;
            return { streams: [{ title: channel.name, url: proxyUrl, behaviorHints: { notWebReady: true, bingeGroup: `rc2stm-${channel.id}` } }] };
        }
    }
    return { streams: [] };
});

module.exports = builder.getInterface();