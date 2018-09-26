const cli = require('commander');
const semver = require('semver');
const semverLevels = ['major', 'minor', 'patch'];
const path = require('path');
const fs = require('fs');
const { exec } = require('shelljs');
const logger = require('../logger');
const { version } = require('../../package.json');

// Parse command options
cli.version(version)
    .option('-lvl --semver-level [semverLevel]', `One of ${semverLevels.join('|')}. Ignored when --is-hotfix supplied.`)
    .option('-b --target-branch <targetBranch>', 'Branch to release. One of develop|hotfix/*|feature/*|bugfix/*|release/*')
    .option('-p --package-manager <packageManager>', 'One of yarn|npm')
    .parse(process.argv);

const config = Object.assign({ semverLevel: undefined, targetBranch: null, packageManager: 'npm' },
                             ({ semverLevel: cli.semverLevel, targetBranch: cli.targetBranch, packageManager: cli.packageManager }));

config.isYARN = config.packageManager === 'yarn';
config.isNPM = config.packageManager === 'npm';
config.isDevelop = /^develop$/.test(config.targetBranch);
config.isHotfix = /^hotfix\/./.test(config.targetBranch);
config.isRelease = /^release\/./.test(config.targetBranch);
config.isFeature = /^feature\/./.test(config.targetBranch);
config.isBugfix = /^bugfix\/./.test(config.targetBranch);
config.isMergeableBranch = isDevelop || isHotfix || isBugfix || isFeature || isRelease;
config.currentDirectory = exec('pwd', { silent: true }).stdout.trim();

// Check options
if (!config.isMergeableBranch) {
    logger.error(`--target-branch required and must be one of develop|hotfix/*|feature/*|bugfix/*|release/*.`);
    process.exit(1);
}

if (config.isHotfix) {
    logger.warn(`Hotfixes assume semver patch level.`);
    config.semverLevel = 'patch';
} else {
    if (!semverLevels.includes(config.semverLevel)) {
        logger.error(`--semver-level required and must be one of ${semverLevels.join('|')}.`);
        process.exit(1);
    }

    if (config.semverLevel === 'patch') {
        logger.warn('Non-hotfixes assume a minimum of minor version bump. Assuming \'minor\'.');
        config.semverLevel = 'minor';
    }
}

// Helpers
const errorHandler = (error) => {
    if (error) {
        logger.error(`${error.message}`);
        process.exit(1);
    }
};

const setVersion = (filePath, version) => {
    let file = require(path.resolve(filePath));
    file.version = version;
    logger.info(`${filePath} -> ${version}`);
    fs.writeFileSync(filePath, JSON.stringify(file, null, 2))
};

const execOrFail = (command, { silent } = { silent: true }) => {
    const { code, stdout, stderr } = exec(command, { silent });
    if (code !== 0) {
        logger.error(stderr);
        process.exit(code);
    }
    return { code, stdout, stderr };
};

module.exports = async function release() {
    logger.info('Fetching from origin.');
    execOrFail('git fetch');
    logger.info('Checking if tree is clean.');
    const repoIsDirty = exec('git status --porcelain', {silent: true}).code !== 0;
    if (repoIsDirty) {
        errorHandler(new Error(`Current tree not clean. Stash or commit changes before attempting this again.`));
    }

    config.currentBranch = execOrFail('git rev-parse --abbrev-ref HEAD').stdout.trim();

    logger.info('Looking for latest tag.');
    const tags = execOrFail('git tag -l \'v*.*.*\' | xargs', { silent: true })
                    .stdout.trim().split(' ').filter(tag => semver.valid(tag) !== null);
    const latestTag = tags.pop();
    if (!semver.valid(latestTag)) {
        errorHandler(new Error(`Invalid latest tag ${latestTag}`));
    }
    config.latestTag = latestTag;
    config.latestVersion = semver.clean(config.latestTag);
    config.currentTagName = `v${config.latestVersion}`;
    config.nextVersion = semver.inc(config.latestVersion, config.semverLevel);
    config.nextTagName = `v${config.nextVersion}`;
    config.releaseBranchName = `release/${config.nextTagName}`;

        logger.info(`Starting release with parameters:
================================================================
current directory: ${config.currentDirectory}
target branch    : ${config.targetBranch}
current branch   : ${config.currentBranch}
================================================================`);

        logger.info(`Pulling ${config.targetBranch}`);
        execOrFail(`git checkout ${config.targetBranch} && git fetch && git pull`);

        // Merge the feature branch into develop
        if (config.isFeature || config.isBugfix) {
            logger.info(`Merging branch ${config.targetBranch} into develop`);
            execOrFail('git checkout develop');
            execOrFail(`git merge --no-ff --no-edit -m "Merge ${config.targetBranch} into develop" ${config.targetBranch}`);
            execOrFail('git push origin develop:develop');
        }

        // Create a release branch based off develop
        if (config.isDevelop) {
            const updatableFiles = ['./package.json'];
            if (config.isNPM) {
                updatableFiles.push('./package-lock.json');
            }
            logger.info(`Creating relase branch ${config.releaseBranchName}`);
            execOrFail(`git checkout -b ${config.releaseBranchName}`);

            logger.info(`Updating versions in ${updatableFiles.join(',')}`);
            updatableFiles.map(filePath => setVersion(filePath, config.nextVersion));
            execOrFail(`git add . && git commit -m "${config.releaseBranchName}"`);

            logger.info(`Pushing branch ${config.releaseBranchNamee} in origin`);
            execOrFail(`git push --set-upstream origin ${config.releaseBranchName}`);
        }

        // Merge hotfix into develop and master and update both
        if (config.isHotfix) {
            logger.info(`Merging ${config.targetBranch} into develop`);
            execOrFail('git checkout develop && git fetch && git pull');
            execOrFail(`git merge --no-ff --no-edit -m "Merge ${config.targetBranch} into develop" ${config.targetBranch}`);

            logger.info(`Merging ${config.targetBranch} into master`);
            execOrFail('git checkout master && git fetch && git pull');
            execOrFail(`git merge --no-ff --no-edit -m "Merge ${config.targetBranch} into master" ${config.targetBranch}`);

            logger.info('Creating and pushing tag');
            execOrFail(`git tag -a ${config.nextTagName} -m "Merge ${config.targetBranch} into master"`);
            execOrFail(`git push origin ${config.nextTagName}`);

            logger.info('Pushing develop and master');
            execOrFail('git push origin develop:develop');
            execOrFail('git push origin master:master');
        }

        // Merge release into master
        if (config.isRelease) {
            logger.info(`Merging ${config.targetBranch} into master`);
            execOrFail('git checkout develop && git fetch && git pull');
            execOrFail(`git merge --no-ff --no-edit -m "Merge ${config.targetBranch} into master" ${config.targetBranch}`);

            logger.info('Creating and pushing tag');
            execOrFail(`git tag -a ${config.nextTagName} -m "Merge ${config.targetBranch} into master"`);
            execOrFail(`git push origin ${config.nextTagName}`);

            logger.info('Pushing develop and master');
            execOrFail('git push origin develop:develop');
            execOrFail('git push origin master:master');
        }

        logger.info('Done.');
        process.exit(0);
};
