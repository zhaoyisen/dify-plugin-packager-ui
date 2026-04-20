#!/bin/bash
# based on xjl456852/dify-plugin-repackaging-plus

DEFAULT_GITHUB_API_URL=https://github.com
DEFAULT_MARKETPLACE_API_URL=https://marketplace.dify.ai
DEFAULT_PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple

GITHUB_API_URL="${GITHUB_API_URL:-$DEFAULT_GITHUB_API_URL}"
MARKETPLACE_API_URL="${MARKETPLACE_API_URL:-$DEFAULT_MARKETPLACE_API_URL}"
PIP_MIRROR_URL="${PIP_MIRROR_URL:-$DEFAULT_PIP_MIRROR_URL}"

ARCH=`if [ "$(uname -m)" = "x86_64" ]; then echo "dify-plugin-linux-amd64-5g"; else echo "dify-plugin-linux-arm64-5g"; fi`

CURR_DIR=`dirname $0`
cd $CURR_DIR || exit 1
CURR_DIR=`pwd`

market(){
  if [[ -z "$2" || -z "$3" || -z "$4" ]]; then
    echo ""
    echo "Usage: "$0" market [plugin author] [plugin name] [plugin version]"
    exit 1
  fi
  echo "From the Dify Marketplace downloading ..."
  PLUGIN_AUTHOR=$2
  PLUGIN_NAME=$3
  PLUGIN_VERSION=$4
  PLUGIN_PACKAGE_PATH=${CURR_DIR}/${PLUGIN_AUTHOR}-${PLUGIN_NAME}_${PLUGIN_VERSION}.difypkg
  PLUGIN_DOWNLOAD_URL=${MARKETPLACE_API_URL}/api/v1/plugins/${PLUGIN_AUTHOR}/${PLUGIN_NAME}/${PLUGIN_VERSION}/download
  echo "Downloading ${PLUGIN_DOWNLOAD_URL} ..."
  curl -L -o ${PLUGIN_PACKAGE_PATH} ${PLUGIN_DOWNLOAD_URL}
  if [[ $? -ne 0 ]]; then
    echo "Download failed, please check the plugin author, name and version."
    exit 1
  fi
  echo "Download success."
  repackage ${PLUGIN_PACKAGE_PATH}
}

github(){
  if [[ -z "$2" || -z "$3" || -z "$4" ]]; then
    echo ""
    echo "Usage: "$0" github [Github repo] [Release title] [Assets name (include .difypkg suffix)]"
    exit 1
  fi
  echo "From the Github downloading ..."
  GITHUB_REPO=$2
  if [[ "${GITHUB_REPO}" != "${GITHUB_API_URL}"* ]]; then
    GITHUB_REPO="${GITHUB_API_URL}/${GITHUB_REPO}"
  fi
  RELEASE_TITLE=$3
  ASSETS_NAME=$4
  PLUGIN_NAME="${ASSETS_NAME%.difypkg}"
  PLUGIN_PACKAGE_PATH=${CURR_DIR}/${PLUGIN_NAME}-${RELEASE_TITLE}.difypkg
  PLUGIN_DOWNLOAD_URL=${GITHUB_REPO}/releases/download/${RELEASE_TITLE}/${ASSETS_NAME}
  echo "Downloading ${PLUGIN_DOWNLOAD_URL} ..."
  curl -L -o ${PLUGIN_PACKAGE_PATH} ${PLUGIN_DOWNLOAD_URL}
  if [[ $? -ne 0 ]]; then
    echo "Download failed, please check the github repo, release title and assets name."
    exit 1
  fi
  echo "Download success."
  repackage ${PLUGIN_PACKAGE_PATH}
}

_local(){
  if [[ -z "$2" ]]; then
    echo ""
    echo "Usage: "$0" local [difypkg path]"
    exit 1
  fi
  PLUGIN_PACKAGE_PATH=`realpath $2`
  repackage ${PLUGIN_PACKAGE_PATH}
}

repackage(){
  local PACKAGE_PATH=$1
  PACKAGE_NAME_WITH_EXTENSION=`basename ${PACKAGE_PATH}`
  PACKAGE_NAME="${PACKAGE_NAME_WITH_EXTENSION%.*}"
  echo "Unziping ..."
  install_unzip
  unzip -o ${PACKAGE_PATH} -d ${CURR_DIR}/${PACKAGE_NAME}
  if [[ $? -ne 0 ]]; then
    echo "Unzip failed."
    exit 1
  fi
  echo "Unzip success."
  echo "Repackaging ..."
  cd ${CURR_DIR}/${PACKAGE_NAME} || exit 1
  mkdir -p ./wheels
  if [[ -f requirements.txt ]]; then
    pip download -r requirements.txt -d ./wheels --index-url ${PIP_MIRROR_URL}
    sed -i '1i\--no-index --find-links=./wheels/' requirements.txt
  else
    echo "No requirements.txt found, skipping dependency download."
  fi
  if [ -f .difyignore ]; then
    sed -i '/^wheels\//d' .difyignore
  fi
  cd ${CURR_DIR} || exit 1
  chmod 755 ${CURR_DIR}/${ARCH}
  ${CURR_DIR}/${ARCH} plugin package ${CURR_DIR}/${PACKAGE_NAME} -o ${CURR_DIR}/${PACKAGE_NAME}-offline.difypkg
  echo "Repackage success."
}

install_unzip(){
  if ! command -v unzip &> /dev/null; then
    echo "Installing unzip ..."
    if command -v apt &> /dev/null; then
      apt -y update && apt -y install unzip
    elif command -v yum &> /dev/null; then
      yum -y install unzip
    elif command -v dnf &> /dev/null; then
      dnf -y install unzip
    else
      echo "Unable to install unzip automatically."
      exit 1
    fi
    if [ $? -ne 0 ]; then
      echo "Install unzip failed."
      exit 1
    fi
  fi
}

case "$1" in
  'market')
  market $@
  ;;
  'github')
  github $@
  ;;
  'local')
  _local $@
  ;;
  *)
  echo "usage: $0 {market|github|local}"
  exit 1
esac

exit 0
