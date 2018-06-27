const cli = require('commander');
const semver = require('semver');
const semverLevels = ['major', 'minor', 'patch'];
const path = require('path');
const fs = require('fs');
const git = require('simple-git')(path.resolve('.'));
const { execFile } = require('child_process');
const { exec } = require('shelljs');

// Parse command options
cli.version('0.1.0')
    .option('-lvl --semver-level [semverLevel]', `One of ${semverLevels.join('|')}. Ignored when --is-hotfix supplied.`)
    .option('-b --target-branch <targetBranch>', 'Branch to release. One of develop|hotfix/*')
    .parse(process.argv);

const config = Object.assign({ semverLevel: undefined, targetBranch: null },
                             ({ semverLevel: cli.semverLevel, targetBranch: cli.targetBranch }));
config.isMergeableBranch = /^develop$|^hotfix\/./.test(config.targetBranch);
config.isHotfix = /^hotfix\/./.test(config.targetBranch);
config.isNormalRelease = !config.isHotfix;

// Check options
if (!config.isMergeableBranch) {
    console.log(`ERROR: --target-branch required and must be one of develop|hotfix/*. Got: ${config.targetBranch}`);
    process.exit(1);
}

if (config.isHotfix) {
    console.log(`INFO: Hotfixes assume semver patch level.`);
    config.semverLevel = 'patch';
} else {
    if (!semverLevels.includes(config.semverLevel)) {
        console.log(`ERROR: --semver-level required and must be one of ${semverLevels.join('|')}. Got: ${config.semverLevel}`);
        process.exit(1);
    }
}

// Helpers
const errorHandler = (error) => {
    if (error) {
        console.log(`ERROR: ${error.message}`);
        process.exit(1);
    }
};

const setVersion = (filePath, version) => {
    let file = require(path.resolve(filePath));
    file.version = version;
    console.log(`${filePath} -> ${version}`);
    fs.writeFileSync(filePath, JSON.stringify(file, null, 2))
};

// Release function
const release = async () => {
    exec('git fetch');

    await git.status((error, statusSummary) => {
            errorHandler(error);
            const { files, staged, current } = statusSummary;
            config.currentBranch = `${current}`;
            config.gitIsClean = (statusSummary.files.length + statusSummary.staged.length) === 0;
            if (!config.gitIsClean) {
                errorHandler(new Error(`Current tree not clean. Stash or commit changes before attempting this again.`));
            }
        })
        .tags((error, tags) => {
            errorHandler(error);
            if (!semver.valid(tags.latest)) {
                errorHandler(new Error(`Invalid latest tag ${tags.latest}`));
            }
            config.latestTag = tags.latest;
            config.latestVersion = semver.clean(config.latestTag);
            config.currentTagName = `v${config.latestVersion}`;
            config.nextVersion = semver.inc(config.latestVersion, config.semverLevel);
            config.nextTagName = `v${config.nextVersion}`;
            config.releaseBranchName = `release/v${config.nextVersion}`;
            config.commitMessage = config.isHotfix ? config.targetBranch : config.releaseBranchName;
            config.outputZipFile = path.resolve(`./releases/${config.nextTagName}.zip`);
        });

        console.log(`================================================================
${config.semverLevel} release: ${config.currentTagName} -> ${config.nextTagName}
target branch: ${config.targetBranch}
current branch: ${config.currentBranch}
release branch: ${config.releaseBranchName}
output zip file: ${config.outputZipFile}
================================================================`);

        const branchToMerge = config.isHotfix ? config.targetBranch : config.releaseBranchName;
        const updatableFiles = ['./package.json', './package-lock.json','./src/manifest.json'];

        exec('git checkout master && git pull');
        exec(`git checkout ${config.targetBranch} && git pull`);

        if (config.isNormalRelease) {
            exec(`git checkout -b ${config.releaseBranchName}`);
        }

        updatableFiles.map(filePath => setVersion(filePath, config.nextVersion));
        exec(`git commit -am ${config.commitMessage}`);

        exec('git checkout develop');
        exec(`git merge --no-ff -m ${config.commitMessage} ${branchToMerge}`);

        exec('git checkout master');
        exec(`git merge --no-ff -m ${config.commitMessage} ${branchToMerge}`);

        exec(`git tag -a -m ${config.nextTagName}`);
        exec('git push origin', `refs/tags/${config.nextTagName}`);

        exec('git push origin develop:develop');
        exec('git push origin master:master');
        exec(`git branch -d ${branchToMerge}`);

        process.exit(0);
};

release();