const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
    id: 'org.rc2stm.addon',
    version: '1.8.0',
    name: 'RedeCanais TV',
    description: 'Live Brazilian TV channels for Stremio (Powered by IPTV-org)',
    resources: ['catalog', 'meta', 'stream'],
    types: ['channel'],
    catalogs: [
        {
            type: 'channel',
            id: 'rc2stm_channels',
            name: 'RedeCanais TV Channels'
        }
    ],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};

const builder = new addonBuilder(manifest);

const DEFAULT_M3U_URL = 'https://iptv-org.github.io/iptv/countries/br.m3u';

let channelsCache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

async function parseM3U(m3uUrl) {
    if (channelsCache && (Date.now() - cacheTime) < CACHE_TTL) {
        return channelsCache;
    }
    try {
        const url = m3uUrl || DEFAULT_M3U_URL;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000
        });
        const lines = response.data.split('\n');
        const channels = [];
        const seen = new Set();
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXTINF')) {
                const line = lines[i];
                
                const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
                const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';
                
                const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
                const tvgLogo = tvgLogoMatch ? tvgLogoMatch[1] : '';
                
                const groupMatch = line.match(/group-title="([^"]*)"/);
                const group = groupMatch ? groupMatch[1] : '';
                
                const name = line.split(',').pop().trim();
                const streamUrl = lines[i + 1] ? lines[i + 1].trim() : null;
                
                if (streamUrl && streamUrl.startsWith('http') && name) {
                    const id = tvgId || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_@.]/g, '');
                    if (!seen.has(id)) {
                        seen.add(id);
                        channels.push({
                            id: id,
                            name: name,
                            url: streamUrl,
                            logo: tvgLogo || '',
                            group: group
                        });
                    }
                }
            }
        }
        channelsCache = channels;
        cacheTime = Date.now();
        console.log(`Parsed ${channels.length} channels from ${url}`);
        return channels;
    } catch (e) {
        console.error('Error fetching M3U:', e.message);
        return [];
    }
}

builder.defineMetaHandler(async (args) => {
    if (args.type === 'channel') {
        const channels = await parseM3U();
        const channel = channels.find(c => c.id === args.id);
        if (channel) {
            return {
                meta: {
                    id: channel.id,
                    type: 'channel',
                    name: channel.name,
                    poster: channel.logo || undefined,
                    logo: channel.logo || undefined,
                    description: `Canal: ${channel.name}${channel.group ? ' | Categoria: ' + channel.group : ''}`,
                    genres: channel.group ? [channel.group] : []
                }
            };
        }
    }
    return { meta: null };
});

builder.defineCatalogHandler(async (args) => {
    if (args.id === 'rc2stm_channels') {
        const channels = await parseM3U();
        return {
            metas: channels.map(c => ({
                id: c.id,
                type: 'channel',
                name: c.name,
                poster: c.logo || undefined,
                logo: c.logo || undefined
            }))
        };
    }
    return { metas: [] };
});

builder.defineStreamHandler(async (args) => {
    if (args.type === 'channel') {
        const channels = await parseM3U();
        const channel = channels.find(c => c.id === args.id);
        
        if (channel) {
            const proxyUrl = `http://localhost:${process.env.PORT || 7000}/proxy?url=${encodeURIComponent(channel.url)}`;
            return {
                streams: [{
                    title: channel.name,
                    url: proxyUrl,
                    behaviorHints: {
                        notWebReady: true,
                        bingeGroup: `rc2stm-${channel.id}`
                    }
                }]
            };
        }
    }
    return { streams: [] };
});

module.exports = builder.getInterface();
