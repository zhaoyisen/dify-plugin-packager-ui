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

prepare_plugin_for_offline_package(){
  local plugin_dir=$1
  local difyignore_file="${plugin_dir}/.difyignore"

  if [[ -f "${plugin_dir}/uv.lock" ]]; then
    rm -f "${plugin_dir}/uv.lock"
    echo "Removed uv.lock to avoid forcing online dependency resolution during Dify install."
  fi

  if [[ -f "${difyignore_file}" ]]; then
    sed -i \
      -e '/^wheels\/\?$/d' \
      -e '/^wheels\/\*\*$/d' \
      -e '/^\*\.whl$/d' \
      -e '/^uv\.lock$/d' \
      "${difyignore_file}"
  fi
}

enable_offline_requirements(){
  local requirements_file=$1

  if [[ ! -f "${requirements_file}" ]]; then
    return 0
  fi

  if grep -qxF -- '--no-index --find-links=./wheels/' "${requirements_file}"; then
    return 0
  fi

  local temp_requirements="${requirements_file}.tmp"
  {
    printf '%s\n' '--no-index --find-links=./wheels/'
    cat "${requirements_file}"
  } > "${temp_requirements}"
  mv "${temp_requirements}" "${requirements_file}"
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
  prepare_plugin_for_offline_package "${CURR_DIR}/${PACKAGE_NAME}"
  if [[ -f requirements.txt ]]; then
    pip download -r requirements.txt -d ./wheels --index-url ${PIP_MIRROR_URL}
    enable_offline_requirements requirements.txt
  else
    echo "No requirements.txt found, skipping dependency download."
    if [[ -f pyproject.toml ]]; then
      echo "Warning: pyproject.toml detected without requirements.txt; Dify may still try to resolve dependencies online."
    fi
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
