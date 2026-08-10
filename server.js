const { serveHTTP } = require('stremio-addon-sdk');
const addon = require('./index');

const PORT = process.env.PORT || 7000;

serveHTTP(addon, { port: PORT }, () => {
    console.log(`Addon running at http://localhost:${PORT}/manifest.json`);
});