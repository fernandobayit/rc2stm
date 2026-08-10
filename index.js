const { addonBuilder } = require('stremio-addon-sdk');

const manifest = {
    id: 'org.rc2stm.addon',
    version: '1.0.0',
    name: 'RedeCanais TV for Stremio',
    description: 'Stream channels from redecanaistv.capital directly in Stremio',
    resources: ['stream'],
    types: ['series'],
    catalogs: [],
};

const builder = new addonBuilder(manifest);

// Mock data based on target site categories
const CHANNELS = [
    { id: 'globo_sp', name: 'Globo SP', url: 'http://example.com/stream1.m3u8' },
    { id: 'sbt_sp', name: 'SBT SP', url: 'http://example.com/stream2.m3u8' },
    { id: 'band_sp', name: 'Band SP', url: 'http://example.com/stream3.m3u8' },
    { id: 'record_sp', name: 'Record SP', url: 'http://example.com/stream4.m3u8' },
];

builder.defineStreamHandler((args) => {
    if (args.type === 'series') {
        const channel = CHANNELS.find(c => c.id === args.id);
        if (channel) {
            return Promise.resolve({
                streams: [{
                    title: channel.name,
                    url: channel.url
                }]
            });
        }
    }
    return Promise.resolve({ streams: [] });
});

module.exports = builder.getInterface();
