# OctaNodes for VS Code

VS Code 에서 [OctaNodes](https://octanodes.com) 일감을 조회·등록·처리하는 확장입니다.
AI 없이 OctaNodes REST API 를 직접 호출합니다.

## 기능

- **내 일감 트리뷰** — 사이드바에서 나에게 할당된 일감을 프로젝트별/상태별/우선순위별로 확인 (그룹 기준 전환)
- **상태 필터** — 미완료만 / 전체 / 열림 / 진행중 / 확인대기 / 종료 (필터·그룹 기준은 재시작 후에도 유지)
- **상태바 + 자동 새로고침** — 하단 상태바에 미완료 일감 수 표시, 주기적 폴링으로 새 일감·상태 변경 시 알림
- **일감 검색** — 제목·#번호로 전사 일감 라이브 검색
- **일감 상세 (웹뷰)** — 본문·단계·댓글 확인, 툴바에서 상태·우선순위·담당자·마감일 변경, 제목·본문 인라인 수정, 브라우저에서 열기
- **일감 등록** — 프로젝트·제목·본문·우선순위 입력
- **댓글 추가** — `@이름#id` 멘션 지원

## 시작하기

1. 확장을 설치합니다.
2. OctaNodes 웹에 로그인 → **내 정보 → 보안 탭** 에서 개인 액세스 토큰(PAT)을 발급합니다. (`sk_octa_...`)
3. VS Code 명령 팔레트에서 **`OctaNodes: 로그인`** 실행 → 토큰을 붙여넣습니다.
   - 토큰은 OS 키체인(VS Code SecretStorage)에 안전하게 저장되며, 설정 파일에 평문으로 남지 않습니다.
4. 활동 표시줄의 OctaNodes 아이콘에서 내 일감을 확인합니다.

## 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `octanodes.baseUrl` | `https://octanodes.com/api/v1` | API 베이스 URL. 온프렘/로컬 개발 시 변경 |
| `octanodes.refreshInterval` | `120` | 자동 새로고침 주기(초). `0` 이면 자동 새로고침 끔 |

## 개발

```bash
npm install
npm run watch      # esbuild watch 번들
# VS Code 에서 F5 (Extension Development Host)
npm run package    # .vsix 생성 (vsce)
```

## 라이선스

MIT
