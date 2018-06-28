const path = require('path');
const fs = require('fs');
const git = require('simple-git')(path.resolve('.'));
const { exec } = require('shelljs');

publish();

// Release function
async function publish () {
    await git.status((error, statusSummary) => {
        if (error) {
            console.log(error.message);
            process.exit(1);
        }

        const currentBranch = process.env.DRONE_COMMIT_BRANCH || statusSummary.current;
        if (currentBranch !== 'master') {
            console.log(`Cannot publish from non-master branch: ${currentBranch}`);
            process.exit(1);
        }
    });
    const requiredEnvVars = ['CHROME_WEBSTORE_OAUTH_SECRET', 'CHROME_WEBSTORE_OAUTH_REFRESH_TOKEN'];
    requiredEnvVars.map(envVar => {
        if (!process.env[envVar]) {
            console.log(`env var CHROME_WEBSTORE_OAUTH_SECRET required for publishing and not set.`);
            process.exit(1);
        }
    });
    // Things needed by webstore
    // Ref: https://circleci.com/blog/continuously-deploy-a-chrome-extension/
    // To regenerate these, from the chrome dev dashboard:
    // 1. Enable Chrome wesbtore API
    // 2. Create an oAuth client. Will give CLIENT_ID and CLIENT_SECRET
    // 3. Retrieve a code that allows you to get a refresh token (replace $CLIENT_ID with your own)
    //      https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=$CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob
    // 4. Get a refresh token within 10 mins of step 3, replace $CLIENT_ID,$CLIENT_SECRET,$CODE with your own:
    // curl "https://accounts.google.com/o/oauth2/token" -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&code=$CODE&grant_type=authorization_code&redirect_uri=urn:ietf:wg:oauth:2.0:oob" | jq '.refresh_token'
    const webstoreConfig = {
        oAuth: {
            client_id: '765376918327-n50m9cuqu1uoopm4qsu5kq5jahtfq1h7.apps.googleusercontent.com',
            client_secret: process.env.CHROME_WEBSTORE_OAUTH_SECRET,
            refresh_token: process.env.CHROME_WEBSTORE_OAUTH_REFRESH_TOKEN
        },
        extensionId: 'cgdbbdcopmjndpjphncfaaeghknelfpi'
    };

    const version = exec('node -p "require(\'./package.json\').version"').stdout;
    const zipFile = path.resolve(`./v${version}.zip`);
    const buildDir = path.resolve('../build');
    const manifestPath = path.join(buildDir, 'manifest.json');
    const manifest = require('../build/manifest.json');
    manifest.version = version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    console.log(`Publising v${version} to the webstore.`);
    exec(`rm ${zipFile}`);
    exec(`zip -r ${zipFile} ${buildDir}`);

    // Publishing to webstore
    // Keep all commands with {silent: true} to avoid spilling secrets
    // into build logs.
    const { client_id, client_secret, refresh_token } = webstoreConfig.oAuth;
    const accessToken = exec(`curl "https://accounts.google.com/o/oauth2/token" -d "client_id=${client_id}&client_secret=${client_secret}&refresh_token=${refresh_token}&grant_type=refresh_token&redirect_uri=urn:ietf:wg:oauth:2.0:oob" | jq -r .access_token`, {silent: true}).stdout;

    const uploadResult = exec(`curl -H "Authorization: Bearer ${accessToken}" -H "x-goog-api-version: 2" -X PUT -T ${zipFile} -v "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${webstoreConfig.extensionId}"`,
                              {silent: true});
    if (uploadResult.code !== 0) {
        console.log(`Failed to upload to chrome webstore: ${publishResult.stderr}`);
        process.exit(1);
    }

    const publishResult = exec(`curl -H "Authorization: Bearer ${accessToken}" -H "x-goog-api-version: 2" -H "Content-Length: 0" -X POST -v "https://www.googleapis.com/chromewebstore/v1.1/items/${webstoreConfig.extensionId}/publish"`, {silent: true});
    if (publishResult.code !== 0) {
        console.log(`Failed to publish to chrome webstore: ${publishResult.stderr}`);
        process.exit(1);
    }

    console.log(`Successfully published v${version} of teston-chrome-extension`);
    process.exit(0);
};
