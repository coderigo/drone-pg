const { exec } = require('shelljs');

exec('rm -rf build');
exec('mkdir -p build');
exec('cp src/manifest.json build/manifest.json');
