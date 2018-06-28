const path = require('path');
const git = require('simple-git')(path.resolve('.'));
const { exec } = require('shelljs');

publish();

// Release function
async function publish () {
    exec('git checkout master && git pull');
    const { version } = require('./build/manifest.json');
    const zipFile = path.resolve(`./v${version}.zip`);
    const buildDir = path.resolve('./build');
    console.log(`Publising v${version} to the webstore.`);
    exec(`zip -r ${zipFile} ${buildDir}`);
    process.exit(0);
};