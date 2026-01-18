# README

## Agent Regression Tester

> LLM 에이전트의 불확실한 응답 품질을 자동화된 파이프라인으로 검증하고 관리합니다.
> 

### Why This Project?

LLM 에이전트 개발은 일반적인 백엔드 개발과 다릅니다. 프롬프트 한 줄, 소스코드 한 줄의 수정이 수백 개의 테스트 케이스에 어떤 영향을 줄지 예측하기 어렵습니다.
이 프로젝트는 "딱 떨어지지 않는 LLM 응답"을 효율적으로 검증하기 위해 시작되었습니다. 매일 반복되는 수동 테스트와 번역 작업을 자동화하여, 개발자가 **본질적인 제품의 가치**에 집중할 수 있도록 돕습니다.

### Key Features

- **Multi-Environment Support:** Local부터 Production까지 다양한 환경의 API를 한 번에 테스트합니다.
- **AI-Driven Judge:** Google Gemini API 또는 로컬 LLM(Ollama/Gemma2)을 활용하여 응답의 적절성을 자동으로 판독합니다.
- **Auto Translation:** Google Sheets의 `=GOOGLETRANSLATE`를 활용하여 베트남어 등 외국어 응답을 실시간으로 번역하여 확인합니다.
- **Slack Integration:** 테스트 완료 후 성공/실패 여부를 슬랙으로 즉시 알림 받아 리얼타임 피드백 루프를 형성합니다.
- **Universal Framework:** 날씨, 음악, 일정 등 모든 도메인의 에이전트 테스트에 적용 가능한 범용적인 구조를 제공합니다.

### Impact

- **검증 리소스 95.8% 절감:** 기존 8시간 소요되던 전수 검사를 20분 내외(검토 시간 기준)로 단축.
- **품질 안정성 확보:** 수백 개의 케이스를 상시 검증하여 공식 시연 및 UAT 리스크 최소화.

---

## Setup & Installation

### 1. Requirements

- Node.js (Jest)
- [Ollama](https://ollama.com/) (Local LLM 사용 시)
- Google Cloud Platform (Google Sheets API 사용 시)

### 2. Environment Variables (`.env`)

프로젝트 루트에 `.env` 파일을 생성하고 아래 형식을 참고하여 설정. 

**(보안을 위해 `.env` 파일은 절대 Git에 커밋 금지!)**

```jsx
CONTROL_BASE_URL=""
X_API_KEY=""

AI_API_KEY=""
AI_MODEL="gemini-3-flash-preview"

GOOGLE_SERVICE_ACCOUNT_EMAIL=""
GOOGLE_SHEET_ID=""
GOOGLE_PRIVATE_KEY=""

ACCOUNT_ID=""
AGENT_VERSION=""
DEVICE_ID=""
OS_APP_TYPE=""
OS_APP_VERSION=""
ACCEPT_LANGUAGE=""
TRACE_ID=""
LANGUAGE=""

TEST_TIMEOUT="120000"

# [Service Delay]
SERVICE_DELAY_SEC=1
# [Judge Delay]
# for Gemini API
DELAY_API=12
# for local Ollama
DELAY_LOCAL=0

LOCAL_AI_MODEL='gemma2:27b'
LOCAL_AI_TEMPERATURE=0.1 # 일관된 판정을 위해 낮게 설정
LOCAL_AI_MAX_TOKEN=200 # 답변이 너무 길어지지 않게 제한
GOOGLETRANSLATE_SOURCE_LANGUAGE="auto"
GOOGLETRANSLATE_TARGET_LANGUAGE="en"

# Slack Settings
SLACK_WEBHOOK_URL=""
SLACK_CHANNEL=""
```

### 3. How to fill in .env file

- Google Sheets API Key
    
    https://console.cloud.google.com/welcome/new
    <img width="1000" height="371" alt="image" src="https://github.com/user-attachments/assets/dbf06aef-1113-4bec-b4c8-b9a855654396" />
    <img width="1266" height="818" alt="image" src="https://github.com/user-attachments/assets/c9776b1b-2934-4e3b-9c9e-3a2d675a13db" />
        Enable Google Sheets API
        
    <img width="1102" height="398" alt="image" src="https://github.com/user-attachments/assets/18896a9d-9318-4f98-8981-452fd920fe38" />
    <img width="1712" height="828" alt="image" src="https://github.com/user-attachments/assets/c1ec1aec-a23a-4971-b09d-0b700650a736" />
        
    Credentials 탭 클릭 → Create Credentials → Service Account
    Service Accounts→ Keys→ Create private key→ Json
    다운로드된 JSON 파일에서
    - `client_email` → Service Account 이메일
    - `private_key` → Private Key
        
    이 두 개를 `.env`에 세팅
        
    ```jsx
    GOOGLE_SERVICE_ACCOUNT_EMAIL=""
    GOOGLE_PRIVATE_KEY=""
    ```
    
- Google Sheets ID
    
    google docs로 파일을 만든 후
    
    주소를 복사하여
    
    [https://docs.google.com/spreadsheets/d/](https://docs.google.com/spreadsheets/d/) + GOOGLE_SHEET_ID +  /edit?gid=0#gid=0
    
    이 구조로 되어있으니 GOOGLE_SHEET_ID를 추출하고 .env에 설정
    
    ```jsx
    GOOGLE_SHEET_ID=""
    ```
    
- Gemini
    
    https://ai.google.dev/gemini-api/docs/models
    여기 가서 모델 고르기

  <img width="3016" height="1558" alt="image" src="https://github.com/user-attachments/assets/0aa2dfa6-4fc3-4d10-90e6-2342023185f5" />

    
    .env에 설정
    
    ```jsx
    AI_MODEL="gemini-3-flash-preview"
    ```
    
- Ollama
    1. [Ollama 공식 홈페이지](https://ollama.com/)에서 다운로드 후 설치
    2. 모델 고르기
    3. 다운받기
    
    ```jsx
    ollama pull gemma2:9b
    ```
    
    1. .env 설정
    
    ```jsx
    LOCAL_AI_MODEL='gemma2:27b'
    ```
    

### 3. Quick Start

```jsx
npm install

npm test all

    "test:all": "node --experimental-vm-modules node_modules/jest/bin/jest.js tests/runner --config jest.config.ts",
    "test:sheet:none": "REPORT_TO=sheet JUDGE_MODE=none npm run test:all",
    "test:sheet:internal": "REPORT_TO=sheet JUDGE_MODE=sheet npm run test:all",
    "test:sheet:api": "REPORT_TO=sheet JUDGE_MODE=api npm run test:all",
    "test:sheet:local": "REPORT_TO=sheet JUDGE_MODE=local npm run test:all",
    "test:local": "REPORT_TO=terminal JUDGE_MODE=none npm run test:all",
    "test:local:ai": "REPORT_TO=terminal JUDGE_MODE=local npm run test:all"
```

### 4. DEMO
테스트가 완료되면 슬랙에 메시지가 전송됩니다.
<img width="707" height="494" alt="image" src="https://github.com/user-attachments/assets/3f94935d-fb64-49e5-843f-00b3bb323794" />

나의 구글 시트에 들어가보면 다음과같이 잘 정리된 테스트 케이스들이 있고 나는 Fail인 것만 검토를 하면 됩니다.
<img width="1210" height="540" alt="image" src="https://github.com/user-attachments/assets/9a4ee244-7cf9-4697-a294-2c3b95c417a9" />


---

## System Architecture

1. **Jest/Axios**: 설정된 환경별로 테스트 케이스(JSON) 기반 API 호출 수행.
2. **Local AI (Gemma2)**: 수집된 응답 데이터가 질문 의도에 부합하는지 1차 판독.
3. **Google Sheet**: 결과를 시트로 전송하여 자동 번역 및 시각화 수행.
4. **Slack Webhook**: 전체 리포트 요약을 개발자에게 전송.

---

## Contributing

이 프로젝트는 더 효율적인 AI 에이전트 개발 문화를 지향합니다. 버그 리포트나 기능 제안은 언제나 환영합니다!
