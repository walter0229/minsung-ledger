#!/usr/bin/env bash
# ==============================================================================
# 민성이의 가계부 및 다중 프로젝트 운영을 위한 신규 IDC 서버 초기 셋업 스크립트
# 대상 OS: Ubuntu Server 24.04 LTS / 22.04 LTS
# ==============================================================================

set -e

echo "======================================================================"
echo " 🚀 [1/5] 서버 기본 설정 및 패키지 업데이트 시작"
echo "======================================================================"

# 1. 타임존 설정 (한국 시간 기준)
sudo timedatectl set-timezone Asia/Seoul
echo "✅ 타임존 설정 완료: $(timedatectl | grep 'Time zone')"

# 2. 패키지 저장소 갱신 및 기본 필수 패키지 설치
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    ufw \
    jq \
    htop \
    net-tools \
    unzip

echo "======================================================================"
echo " 🔒 [2/5] UFW 방화벽 기본 보안 설정"
echo "======================================================================"

# 기본 정책: 수신 거부, 송신 허용
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 필수 포트 허용: SSH(22), HTTP(80), HTTPS(443), Nginx Proxy Manager 관리콘솔(81)
sudo ufw allow 22/tcp comment 'SSH Remote Access'
sudo ufw allow 80/tcp comment 'HTTP Web'
sudo ufw allow 443/tcp comment 'HTTPS Web SSL'
sudo ufw allow 81/tcp comment 'Nginx Proxy Manager Admin'

# 방화벽 활성화 (비대화형)
echo "y" | sudo ufw enable
sudo ufw status verbose
echo "✅ 방화벽 설정 완료"

echo "======================================================================"
echo " 🐳 [3/5] 최신 Docker Engine & Docker Compose 설치"
echo "======================================================================"

# 기존 구버전 도커 제거
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# 공식 도커 GPG 키 추가
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# 도커 저장소 등록
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 현재 사용자를 docker 그룹에 추가하여 sudo 없이 실행 가능하도록 설정
sudo usermod -aG docker $USER || true

# Docker 서비스 시작 및 부팅 시 자동 시작 등록
sudo systemctl enable docker
sudo systemctl restart docker

echo "✅ Docker 설치 완료:"
docker --version
docker compose version

echo "======================================================================"
echo " 🌐 [4/5] 공용 Docker 네트워크 생성 (app-network)"
echo "======================================================================"

# 컨테이너 간 안전하고 유연한 통신을 위한 공용 브릿지 네트워크
if ! docker network ls | grep -q "app-network"; then
  docker network create app-network
  echo "✅ 'app-network' 생성 완료"
else
  echo "ℹ️ 'app-network'가 이미 존재합니다."
fi

echo "======================================================================"
echo " 📦 [5/5] Node.js 20 LTS 설치 (마이그레이션 및 유틸리티 도구 실행용)"
echo "======================================================================"

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "✅ Node.js 설치 완료: $(node -v) / npm: $(npm -v)"

echo ""
echo "======================================================================"
echo " 🎉 축하합니다! 신규 서버 기본 환경 구축이 성공적으로 완료되었습니다."
echo "   - 다음 단계: docker-compose.infra.yml 실행하여 리버스 프록시 및 DB 가동"
echo "======================================================================"
