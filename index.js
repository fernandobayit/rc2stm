const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
    id: 'org.rc2stm.addon',
    version: '1.5.0',
    name: 'RedeCanais TV Functional',
    description: 'Live Brazilian TV channels for Stremio (Powered by IPTV-org)',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [
        {
            type: 'tv',
            id: 'rc2stm_channels',
            name: 'RedeCanais TV Channels'
        }
    ],
};

const builder = new addonBuilder(manifest);

const M3U_URL = 'https://iptv-org.github.io/iptv/countries/br.m3u';

// Cache channels to avoid refetching on every request
let channelsCache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function parseM3U() {
    if (channelsCache && (Date.now() - cacheTime) < CACHE_TTL) {
        return channelsCache;
    }
    try {
        const response = await axios.get(M3U_URL);
        const lines = response.data.split('\n');
        const channels = [];
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXTINF')) {
                const line = lines[i];
                
                // Parse tvg-id
                const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
                const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';
                
                // Parse tvg-logo
                const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
                const tvgLogo = tvgLogoMatch ? tvgLogoMatch[1] : '';
                
                // Parse group-title
                const groupMatch = line.match(/group-title="([^"]*)"/);
                const group = groupMatch ? groupMatch[1] : '';
                
                // Parse channel name (after last comma)
                const name = line.split(',').pop().trim();
                
                // Parse stream URL (next line)
                const url = lines[i + 1] ? lines[i + 1].trim() : null;
                
                if (url && url.startsWith('http') && name) {
                    // Use tvg-id if available, otherwise generate from name
                    const id = tvgId || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                    channels.push({
                        id: id,
                        name: name,
                        url: url,
                        logo: tvgLogo || 'https://via.placeholder.com/300x450?text=TV+Channel',
                        group: group
                    });
                }
            }
        }
        channelsCache = channels;
        cacheTime = Date.now();
        console.log(`Parsed ${channels.length} channels`);
        return channels;
    } catch (e) {
        console.error('Error fetching M3U:', e.message);
        return [];
    }
}

// Meta handler
builder.defineMetaHandler(async (args) => {
    if (args.type === 'tv') {
        const channels = await parseM3U();
        const channel = channels.find(c => c.id === args.id);
        if (channel) {
            return {
                meta: {
                    id: channel.id,
                    type: 'tv',
                    name: channel.name,
                    poster: channel.logo,
                    logo: channel.logo,
                    description: `Canal: ${channel.name}${channel.group ? ' | Categoria: ' + channel.group : ''}`,
                    genres: channel.group ? [channel.group] : []
                }
            };
        }
    }
    return { meta: null };
});

// Catalog handler
builder.defineCatalogHandler(async (args) => {
    if (args.id === 'rc2stm_channels') {
        const channels = await parseM3U();
        return {
            metas: channels.map(c => ({
                id: c.id,
                type: 'tv',
                name: c.name,
                poster: c.logo,
                logo: c.logo
            }))
        };
    }
    return { metas: [] };
});

// Stream handler
builder.defineStreamHandler(async (args) => {
    if (args.type === 'tv') {
        const channels = await parseM3U();
        const channel = channels.find(c => c.id === args.id);
        
        if (channel) {
            return {
                streams: [{
                    title: channel.name,
                    url: channel.url
                }]
            };
        }
    }
    return { streams: [] };
});

module.exports = builder.getInterface();
