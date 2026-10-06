#!/usr/bin/env bash
# RDS CA 번들 내려받기. verify-full 에 필요하다 —
# sslmode=require 는 암호화만 하고 서버 인증서를 검증하지 않는다(MITM 방어 없음).
set -euo pipefail
REGION="${1:-ap-northeast-2}"
mkdir -p certs
curl -fsS -o "certs/rds-${REGION}.pem" \
  "https://truststore.pki.rds.amazonaws.com/${REGION}/${REGION}-bundle.pem"
echo "certs/rds-${REGION}.pem  ($(grep -c 'BEGIN CERTIFICATE' "certs/rds-${REGION}.pem") certs)"
