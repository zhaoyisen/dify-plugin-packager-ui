#!/bin/bash
# based on xjl456852/dify-plugin-repackaging-plus

DEFAULT_GITHUB_API_URL=https://github.com
DEFAULT_MARKETPLACE_API_URL=https://marketplace.dify.ai
DEFAULT_PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple

GITHUB_API_URL="${GITHUB_API_URL:-$DEFAULT_GITHUB_API_URL}"
MARKETPLACE_API_URL="${MARKETPLACE_API_URL:-$DEFAULT_MARKETPLACE_API_URL}"
PIP_MIRROR_URL="${PIP_MIRROR_URL:-$DEFAULT_PIP_MIRROR_URL}"

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

download_with_fallback(){
  local package=$1
  local wheels_dir=$2
  local mirror_option=""

  if [[ -n "${PIP_MIRROR_URL}" ]]; then
    mirror_option="-i ${PIP_MIRROR_URL}"
  fi

  echo "  Trying to download ${package} for arm64..."
  pip download ${mirror_option} \
    --platform manylinux2014_aarch64 \
    --only-binary :all: \
    "${package}" \
    -d "${wheels_dir}" \
    --quiet 2>/dev/null

  if [[ $? -eq 0 ]]; then
    echo "  ✓ Successfully downloaded ${package} (arm64 version)"
    return 0
  fi

  echo "  No arm64 version found, trying platform-independent version..."
  pip download ${mirror_option} \
    "${package}" \
    -d "${wheels_dir}" \
    --quiet 2>/dev/null

  if [[ $? -eq 0 ]]; then
    echo "  ✓ Successfully downloaded ${package} (platform-independent version)"
    return 0
  fi

  echo "  ✗ Failed to download ${package}"
  return 1
}

handle_x86_64_wheels(){
  local wheels_dir=$1
  local mirror_option=""

  if [[ -n "${PIP_MIRROR_URL}" ]]; then
    mirror_option="-i ${PIP_MIRROR_URL}"
  fi

  echo "Checking and handling x86_64 wheels..."
  local x86_files=($(find "${wheels_dir}" -name "*_x86_64.whl" 2>/dev/null))

  if [[ ${#x86_files[@]} -eq 0 ]]; then
    echo "✓ No x86_64 wheels found, all good!"
    return 0
  fi

  echo "Found ${#x86_files[@]} x86_64 wheel(s), processing..."
  for x86_file in "${x86_files[@]}"; do
    local filename=$(basename "${x86_file}")
    echo "  Processing: ${filename}"
    local package_name=$(echo "${filename}" | sed 's/-[0-9].*//')
    local version=$(echo "${filename}" | sed "s/^${package_name}-//" | sed 's/-cp[0-9].*//')
    local aarch64_exists=$(find "${wheels_dir}" -name "${package_name}-${version}*aarch64*.whl" 2>/dev/null | wc -l)

    if [[ $aarch64_exists -gt 0 ]]; then
      echo "    ✓ Found aarch64 version, removing x86_64 version"
      rm -f "${x86_file}"
    else
      echo "    ⚠ No aarch64 version found, attempting to download..."
      local package_spec="${package_name}==${version}"
      pip download ${mirror_option} \
        --platform manylinux2014_aarch64 \
        --only-binary :all: \
        "${package_spec}" \
        -d "${wheels_dir}" \
        --quiet 2>/dev/null

      if [[ $? -eq 0 ]]; then
        local new_aarch64=$(find "${wheels_dir}" -name "${package_name}-${version}*aarch64*.whl" -newer "${x86_file}" 2>/dev/null | wc -l)
        if [[ $new_aarch64 -gt 0 ]]; then
          echo "    ✓ Successfully downloaded aarch64 version, removing x86_64 version"
          rm -f "${x86_file}"
        else
          echo "    ⚠ Download succeeded but no aarch64 version found, trying without version constraint..."
          pip download ${mirror_option} \
            --platform manylinux2014_aarch64 \
            --only-binary :all: \
            "${package_name}" \
            -d "${wheels_dir}" \
            --quiet 2>/dev/null

          if [[ $? -eq 0 ]]; then
            local any_aarch64=$(find "${wheels_dir}" -name "${package_name}-*aarch64*.whl" 2>/dev/null | wc -l)
            if [[ $any_aarch64 -gt 0 ]]; then
              echo "    ✓ Downloaded different version aarch64, removing x86_64 version"
              rm -f "${x86_file}"
            else
              echo "    ✗ Still no aarch64 version available, keeping x86_64 version"
            fi
          else
            echo "    ✗ Failed to download any aarch64 version, keeping x86_64 version"
          fi
        fi
      else
        echo "    ✗ Failed to download aarch64 version, keeping x86_64 version"
      fi
    fi
  done

  local remaining_x86=$(find "${wheels_dir}" -name "*_x86_64.whl" 2>/dev/null | wc -l)
  local total_aarch64=$(find "${wheels_dir}" -name "*aarch64*.whl" 2>/dev/null | wc -l)
  local total_wheels=$(find "${wheels_dir}" -name "*.whl" 2>/dev/null | wc -l)

  echo ""
  echo "Wheels processing summary:"
  echo "  Total wheels: ${total_wheels}"
  echo "  ARM64 wheels: ${total_aarch64}"
  echo "  Remaining x86_64 wheels: ${remaining_x86}"

  if [[ $remaining_x86 -gt 0 ]]; then
    echo "  ⚠ Some x86_64 wheels remain (no ARM64 alternative available)"
    find "${wheels_dir}" -name "*_x86_64.whl" 2>/dev/null | sed 's/.*\//    /'
  else
    echo "  ✓ All wheels are ARM64 compatible!"
  fi

  return 0
}

process_requirements(){
  local requirements_file=$1
  local wheels_dir=$2
  local failed_packages=""
  local mirror_option=""

  if [[ -n "${PIP_MIRROR_URL}" ]]; then
    mirror_option="-i ${PIP_MIRROR_URL}"
  fi

  echo "Processing requirements.txt..."
  echo "Step 1: Attempting batch download for arm64 platform..."
  pip download ${mirror_option} \
    --platform manylinux2014_aarch64 \
    --only-binary :all: \
    -r "${requirements_file}" \
    -d "${wheels_dir}" 2>&1 | tee /tmp/pip_download.log

  if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    echo "Step 2: Some packages failed, processing individually..."
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" || "$line" == \#* ]] && continue
      package=$(echo "$line" | sed 's/#.*//' | xargs)
      [[ -z "$package" ]] && continue
      package_name=$(echo "$package" | sed 's/[<>=!].*//' | xargs)
      if ls "${wheels_dir}"/${package_name}*.whl 2>/dev/null | grep -q .; then
        echo "  ⊙ ${package_name} already downloaded, skipping..."
        continue
      fi
      if ! download_with_fallback "$package" "$wheels_dir"; then
        failed_packages="${failed_packages}${package}\n"
      fi
    done < "${requirements_file}"
  fi

  echo ""
  echo "Step 3: Processing x86_64 wheels..."
  handle_x86_64_wheels "${wheels_dir}"

  if [[ -n "$failed_packages" ]]; then
    echo ""
    echo "⚠ Warning: The following packages could not be downloaded:"
    echo -e "${failed_packages}"
    echo "You may need to manually handle these dependencies."
    return 1
  fi

  echo "✓ All packages processed successfully!"
  return 0
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
    process_requirements "requirements.txt" "./wheels"
    sed -i '1i\--no-index --find-links=./wheels/' requirements.txt
  else
    echo "No requirements.txt found, skipping dependency download."
  fi

  if [ -f .difyignore ]; then
    sed -i '/^wheels\//d' .difyignore
  fi

  cd ${CURR_DIR} || exit 1
  chmod 755 ${CURR_DIR}/dify-plugin-linux-amd64-5g
  ${CURR_DIR}/dify-plugin-linux-amd64-5g plugin package ${CURR_DIR}/${PACKAGE_NAME} -o ${CURR_DIR}/${PACKAGE_NAME}-offline.difypkg
  echo "Repackage success."
  echo "Output: ${CURR_DIR}/${PACKAGE_NAME}-offline.difypkg"
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
      echo "Unable to install unzip: no supported package manager found"
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
  echo ""
  echo "Dify Plugin Repackager for ARM64"
  echo "================================="
  echo ""
  echo "Usage: $0 {market|github|local} [options]"
  exit 1
esac

exit 0
