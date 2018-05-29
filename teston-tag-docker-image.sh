#!/bin/bash
# Uses gcloud to tag an image build

TESTON_TAG_DRONE_BUILD="build-${DRONE_BUILD_NUMBER}"
echo "${TESTON_TAG_DRONE_BUILD}"
TESTON_TAG_GIT_HASH="commit-${DRONE_COMMIT_SHA:0:8}"
echo "${TESTON_TAG_GIT_HASH}"

# Tag version only if in master and a version is set
TESTON_COMMIT_TAG_VERSION=$(git ls-remote -t origin | grep ${DRONE_COMMIT} | xargs | cut -d"/" -f3 | sed -e 's/\^{}//g')
if [[ "$DRONE_COMMIT_BRANCH" = "master" ]] && [[ "$DRONE_COMMIT_TAG" != "" ]]; then
    # Do the git magic here.
    TESTON_TAG_GIT_TAG="version-$DRONE_COMMIT_TAG"
    echo "${TESTON_TAG_GIT_TAG}"
fi

