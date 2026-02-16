#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform"

if [ ! -f "$TF_DIR/main.tf" ]; then
  echo "Terraform not initialized yet. Add infra/terraform/*.tf first." >&2
  exit 1
fi

cd "$TF_DIR"

echo "==> terraform fmt -check"
terraform fmt -check

echo "==> terraform init"
terraform init -input=false

echo "==> terraform validate"
terraform validate

echo "==> terraform plan"
terraform plan -input=false

echo "OK"
