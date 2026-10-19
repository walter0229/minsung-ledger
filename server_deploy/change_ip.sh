#!/bin/bash
# ==============================================================================
# 민성이의 가계부 서버 - 공인 IP 원클릭 변경 스크립트 (서버실 이전용)
# 사용법: sudo /opt/minsung-ledger/server_deploy/change_ip.sh <새_공인_IP/서브넷> <새_게이트웨이_IP>
# 예시  : sudo /opt/minsung-ledger/server_deploy/change_ip.sh 103.106.141.150/24 103.106.141.1
# ==============================================================================

set -e

NEW_IP="${1:-103.106.141.150/24}"
NEW_GW="${2:-103.106.141.1}"

# 슬래시(/24)가 없으면 기본 /24 추가
if [[ "$NEW_IP" != *"/"* ]]; then
  NEW_IP_CIDR="${NEW_IP}/24"
  PURE_IP="${NEW_IP}"
else
  NEW_IP_CIDR="${NEW_IP}"
  PURE_IP="${NEW_IP%/*}"
fi

echo "================================================================"
echo " 🔧 서버 공인 IP 설정 변경 중..."
echo "   - 적용할 공인 IP : ${NEW_IP_CIDR} (순수 IP: ${PURE_IP})"
echo "   - 게이트웨이     : ${NEW_GW}"
echo "================================================================"

cat <<EOF > /etc/netplan/00-installer-config.yaml
network:
  version: 2
  ethernets:
    eno1:
      match:
        macaddress: 38:ea:a7:8d:fa:70
      set-name: eno1
      dhcp4: true
      optional: true
    eno2:
      dhcp4: true
      dhcp6: true
      optional: true
      addresses:
        - ${NEW_IP_CIDR}
        - 192.168.150.240/24
      routes:
        - to: default
          via: ${NEW_GW}
          metric: 200
          on-link: true
      nameservers:
        addresses:
          - 8.8.8.8
          - 1.1.1.1
    eno3:
      dhcp4: true
      optional: true
    eno4:
      dhcp4: true
      optional: true
EOF

chmod 600 /etc/netplan/00-installer-config.yaml
netplan apply

# 웹앱 설정 파일 내 기본 공인 IP 주소도 자동 업데이트
CONFIG_JS="/opt/minsung-ledger/js/config.js"
if [ -f "$CONFIG_JS" ]; then
  sed -i "s|export const PUBLIC_SERVER_IP = '.*';|export const PUBLIC_SERVER_IP = '${PURE_IP}';|g" "$CONFIG_JS" || true
fi

systemctl restart minsung-ledger.service || true

echo "✅ 서버 공인 IP (${PURE_IP}) 적용 및 가계부 서비스 재시작 완료!"
echo "👉 접속 주소: http://${PURE_IP}:8080 또는 http://${PURE_IP}"
