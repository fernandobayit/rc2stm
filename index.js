const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
    id: 'org.rc2stm.addon',
    version: '1.4.0',
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

async function parseM3U() {
    try {
        const response = await axios.get(M3U_URL);
        const lines = response.data.split('\n');
        const channels = [];
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXTINF')) {
                const name = lines[i].split(',').pop().trim();
                const url = lines[i + 1] ? lines[i + 1].trim() : null;
                if (url && url.startsWith('http')) {
                    channels.push({
                        id: name.toLowerCase().replace(/\s+/g, '_'),
                        name: name,
                        url: url
                    });
                }
            }
        }
        return channels;
    } catch (e) {
        console.error('Error fetching M3U:', e);
        return [];
    }
}

// Meta handler - must return { meta: { ... } }
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
                    poster: 'https://via.placeholder.com/300x450?text=TV+Channel'
                }
            };
        }
    }
    return { meta: null };
});

// Catalog handler - must return { metas: [...] }
builder.defineCatalogHandler(async (args) => {
    if (args.id === 'rc2stm_channels') {
        const channels = await parseM3U();
        return {
            metas: channels.map(c => ({
                id: c.id,
                type: 'tv',
                name: c.name,
                poster: 'https://via.placeholder.com/300x450?text=TV+Channel'
            }))
        };
    }
    return { metas: [] };
});

// Stream handler - must return { streams: [...] }
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
