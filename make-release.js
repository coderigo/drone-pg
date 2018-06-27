const cli = require('commander');
const semver = require('semver');
const semverLevels = ['major', 'minor', 'patch'];
const path = require('path');
const fs = require('fs');
const git = require('simple-git')(path.resolve('.'));
const { execFile } = require('child_process');

// Parse command options
cli.version('0.1.0')
    .option('-lvl --semver-level [semverLevel]', `One of ${semverLevels.join('|')}. Ignored when --is-hotfix supplied.`)
    .option('-b --target-branch <targetBranch>', 'Branch to release. One of develop|hotfix/*')
    .option('-p --push-on-complete <pushOnComplete>')
    .parse(process.argv);

const config = Object.assign({ semverLevel: undefined, targetBranch: null, pushOnComplete: false },
                             ({ semverLevel: cli.semverLevel, targetBranch: cli.targetBranch, pushOnComplete: cli.pushOnComplete || false }));
config.isMergeableBranch = /^develop$|^hotfix\/./.test(config.targetBranch);
config.isHotfix = /^hotfix\/./.test(config.targetBranch);

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
    console.log(filePath);
    return fs.writeFileSync(filePath, JSON.stringify(file, null, 2))
};

// Release function
const release = async () => {
    await git.fetch()
        .status((error, statusSummary) => {
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
push on complete: ${config.pushOnComplete}
current branch: ${config.currentBranch}
release branch: ${config.releaseBranchName}
output zip file: ${config.outputZipFile}
================================================================`);

        await execFile('git', ['checkout', 'master']);
        await execFile('git', ['pull']);
        await execFile('git', ['checkout', config.targetBranch]);
        await execFile('git', ['pull']);

        if (!config.isHotfix) {
            await execFile('git', ['checkout', '-b', config.releaseBranchName]);
        }

        const updatableFiles = ['./package.json', './package-lock.json','./src/manifest.json'];
        updatableFiles.map(filePath => setVersion(filePath, config.nextVersion));
        await execFile('git', ['archive', '-o', config.outputZipFile]);
        await execFile('git', [...['add'], ...updatableFiles, ...[config.outputZipFile]]);
        await execFile('git', ['commit', '-m', config.commitMessage]);
        await execFile('git', ['checkout', 'master']);
        await execFile('git', ['merge', '--no-ff', '-m', config.commitMessage, config.targetBranch]);
        await execFile('git', ['tag', '-a', config.nextTagName]);
        await execFile('git', ['push', config.nextTagName]);
        await execFile('git', ['push', '-v', 'origin', `refs/tags/${config.nextTagName}`]);
        await execFile('git', ['push', 'origin']);

        if (config.isHotfix) {
            await execFile('git', ['checkout', 'develop']);
            await execFile('git', ['merge', '--no-ff', '-m', config.commitMessage, config.targetBranch]);
        }

        await execFile('git', ['checkout', 'master']);
        console.log('DONE');
    // await git
    //         .checkout('master', errorHandler)
    //         .pull(errorHandler)
    //         .checkout(config.targetBranch, errorHandler)
    //         .exec(async () => {
    //             if (!config.isHotfix) {
    //                 await git.checkoutLocalBranch(config.releaseBranchName, errorHandler);
    //             }
    //             const updatableFiles = ['./package.json', './package-lock.json','./src/manifest.json'];
    //             updatableFiles.map(filePath => setVersion(filePath, config.nextVersion));
    //             await git.exec(() => require('child_process').exec(`git archive -o ${config.outputZipFile}`));
    //             const commitableFiles = [...updatableFiles, ...[config.outputZipFile]];
    //             await git.add(commitableFiles, errorHandler).commit(config.commitMessage);
    //             console.log('DOne archiving');
    //         })
    //         .checkout('master', errorHandler)
    //         .merge([config.targetBranch, '--no-ff', '-m', `${config.commitMessage}`], errorHandler)
    //         .exec(async () => {
    //             return await require('child_process')
    //                     .exec(`git tag -a ${config.nextTagName} && git push origin ${config.nextTagName}`);
    //         })
    //         .checkout(config.currentBranch, errorHandler)
    //         .exec(() => {
    //             console.log('Done. Inspect results and then: git checkout master && git push');
    //         });
};

release();