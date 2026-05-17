#!/usr/bin/env bash
# Builds the Anvil test container for a given Fedora version
# Usage: ./build-container.sh [FEDORA_VERSION]
# Default: 44
# chmod +x build-container.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEDORA_VERSION="${1:-44}"
IMAGE_NAME="anvil-test-pod"
IMAGE_TAG="${IMAGE_NAME}:fedora-${FEDORA_VERSION}"

echo "Building ${IMAGE_TAG}..."

podman build \
  --build-arg "FEDORA_VERSION=${FEDORA_VERSION}" \
  --tag "${IMAGE_TAG}" \
  --file "${SCRIPT_DIR}/Containerfile" \
  "${SCRIPT_DIR}"

echo "Built: ${IMAGE_TAG}"
echo ""
echo "To build all supported versions:"
echo "  ./build-container.sh 42"
echo "  ./build-container.sh 43"
echo "  ./build-container.sh 44"
