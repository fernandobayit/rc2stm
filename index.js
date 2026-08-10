const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = {
    id: 'org.rc2stm.addon',
    version: '1.1.0',
    name: 'RedeCanais TV Functional',
    description: 'Live Brazilian TV channels for Stremio (Powered by IPTV-org)',
    resources: ['stream'],
    types: ['series'],
    catalogs: [],
};

const builder = new addonBuilder(manifest);

// High-quality public Brazilian IPTV source
const M3U_URL = 'https://iptv-org.github.io/iptv/index.m3u';

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
                    channels.push({ id: name.toLowerCase().replace(/\s+/g, '_'), name, url });
                }
            }
        }
        return channels;
    } catch (e) {
        console.error('Error fetching M3U:', e);
        return [];
    }
}

builder.defineStreamHandler(async (args) => {
    if (args.type === 'series') {
        const channels = await parseM3U();
        const channel = channels.find(c => c.id === args.id || c.name === args.id);
        
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
