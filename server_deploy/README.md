# 🖥️ 개인 서버 구축 및 가계부 DB 이전 종합 가이드북

본 문서는 신규 서버 포맷부터 IDC 입고, Docker 인프라 구성, Nginx Proxy Manager 설정, 가계부 DB 구축 및 데이터 100% 마이그레이션까지의 실전 가이드입니다.

---

## 📑 목차
1. [1단계: 서버 OS 설치 및 IDC 네트워크 설정](#1단계-서버-os-설치-및-idc-네트워크-설정)
2. [2단계: 서버 환경 원터치 초기 셋업](#2단계-서버-환경-원터치-초기-셋업)
3. [3단계: 공용 인프라(NPM 리버스 프록시) 실행](#3단계-공용-인프라npm-리버스-프록시-실행)
4. [4단계: Appwrite DB 구축 및 데이터 마이그레이션](#4단계-appwrite-db-구축-및-데이터-마이그레이션)
5. [5단계: 데이터 정합성 검증 및 가계부 연결](#5단계-데이터-정합성-검증-및-가계부-연결)

---

## 1단계: 서버 OS 설치 및 IDC 네트워크 설정

1. **OS 설치**:
   - `Ubuntu Server 24.04 LTS` (또는 22.04 LTS) 부팅 USB를 서버에 연결합니다.
   - 디스크 파티션을 전체 포맷(클린 설치)하고, `OpenSSH Server` 설치에 체크합니다.
2. **IDC 고정 IP 설정**:
   - IDC 담당자로부터 전달받은 공인 IP, 서브넷, 게이트웨이, DNS를 서버의 `/etc/netplan/01-netcfg.yaml` 등에 입력하고 적용합니다.
   ```bash
   sudo netplan apply
   ```

---

## 2단계: 서버 환경 원터치 초기 셋업

외부 PC에서 SSH로 서버에 접속합니다:
```bash
ssh [사용자명]@[서버공인IP]
```

가계부 저장소를 클론하거나 `server_deploy` 폴더를 업로드한 후, 초기 셋업 스크립트를 1회 실행합니다:
```bash
cd /opt
sudo git clone https://github.com/walter0229/minsung-ledger.git
cd minsung-ledger/server_deploy

# 실행 권한 부여 및 셋업 실행
chmod +x install_server.sh
./install_server.sh
```
* **수행 내용**: 타임존(한국), 패키지 최신화, 방화벽(UFW 22/80/443/81 포트 허용), 최신 Docker & Docker Compose 설치, Node.js 20 설치 완료.

---

## 3단계: 공용 인프라(NPM 리버스 프록시) 실행

```bash
docker compose -f docker-compose.infra.yml up -d
```
* 브라우저에서 `http://[서버IP]:81` 로 접속하여 Nginx Proxy Manager 관리 화면에 로그인합니다:
  * **초기 아이디**: `admin@example.com`
  * **초기 비밀번호**: `changeme`
  * 로그인 즉시 본인의 이메일과 새 비밀번호를 설정합니다.

---

## 4단계: Appwrite DB 구축 및 데이터 마이그레이션

### 1) Appwrite 컨테이너 가동
```bash
chmod +x setup_appwrite.sh
./setup_appwrite.sh
```
* 설치 시 HTTP 포트를 `8080` (기본 리버스 프록시와 포트 충돌 방지)으로 지정합니다.
* 브라우저에서 `http://[서버IP]:8080` 으로 접속하여 첫 관리자 계정을 가입합니다.
* 새 프로젝트를 생성합니다:
  * Project Name: `민성이의 가계부`
  * Project ID: `ledger-project` (원하는 ID 지정 가능)
* Appwrite 콘솔 좌측 메뉴에서 **API Keys** 생성:
  * Key Name: `migration-key`
  * Scopes: `Databases` 및 `Documents` 관련 모든 권한 체크 (Full Access) 후 생성된 시크릿 키 복사.

### 2) 데이터 100% 마이그레이션 실행
```bash
# 1. 이전 전 시뮬레이션(Dry-run) 검증 (데이터 이상 유무 체크)
node migrate_data.js --dry-run

# 2. 실제 신규 DB로 일괄 적재 실행
TARGET_ENDPOINT="http://localhost:8080/v1" \
TARGET_PROJECT_ID="ledger-project" \
TARGET_API_KEY="위에서_복사한_API_KEY" \
node migrate_data.js
```

---

## 5단계: 데이터 정합성 검증 및 가계부 연결

### 1) 100% 무결성 검증 (오차 0원 확인)
```bash
TARGET_ENDPOINT="http://localhost:8080/v1" \
TARGET_PROJECT_ID="ledger-project" \
TARGET_API_KEY="위에서_복사한_API_KEY" \
node verify_data.js
```
* 화면에 `🎉 [검증 성공] 신규 서버 DB와 원본 데이터가 100% 완벽히 일치합니다! (오차 0원)` 메시지가 출력되면 이전이 완벽히 끝난 것입니다.

### 2) 도메인 연결 및 SSL(HTTPS) 적용
1. Nginx Proxy Manager(`http://[서버IP]:81`)에 접속
2. **Proxy Hosts** -> **Add Proxy Host**:
   * **Domain Names**: `ledger.대표님도메인.com` (또는 `money.도메인.com`)
   * **Scheme**: `http`
   * **Forward Hostname / IP**: `npm`과 동일한 네트워크 상의 컨테이너 이름 또는 `호스트IP`
   * **Forward Port**: `8080` (Appwrite API 연결 시) 또는 가계부 웹 호스트 포트
   * **SSL 탭**: `Request a new SSL Certificate` 선택, `Force SSL` 체크, `I Agree` 체크 후 저장 -> **무료 SSL 자동 발급 완료!**

### 3) 가계부 앱에서 새 서버로 원클릭 전환
* 가계부 화면 우측 상단 [설정] 메뉴에 신규 추가된 **"데이터베이스 서버 설정"** 항목에서:
  * 엔드포인트: `https://ledger.대표님도메인.com/v1` (또는 `http://[서버IP]:8080/v1`)
  * 프로젝트 ID: `ledger-project`
* [저장 및 연결]을 누르면 즉시 개인 IDC 서버의 DB와 실시간 동기화됩니다!
