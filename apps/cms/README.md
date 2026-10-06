# ICAROS CMS shell

정적 Vite 관리자 화면입니다. `/admin/`에 배치하고 같은 도메인의 `/api/admin/*`을 호출합니다. 저장·게시 결과는 API 응답으로 확인합니다.

## 로컬 실행

루트에서 npm workspace 의존성을 설치한 후 `npm run dev --workspace @icaros/cms`를 실행합니다. 단독 Vite 서버의 기본 포트는 5174이고 `/api/admin`은 기본적으로 로컬 3000 포트로 프록시합니다. 통합 실행은 `./dev.sh`를 사용합니다. `npm run test --workspace @icaros/cms`, `npm run typecheck --workspace @icaros/cms`, `npm run lint --workspace @icaros/cms`, `npm run build --workspace @icaros/cms`로 검사합니다.

전체 화면을 로컬 DB 데이터와 함께 살펴보려면 루트에서 `./dev.sh`를 실행하세요. CMS는 `http://127.0.0.1:5175/admin/`, 실제 로컬 API는 5176, 공개 정적 웹은 5174 포트에서 열립니다. CMS의 저장·게시는 로컬 DB와 빌드 파이프라인에 연결됩니다. API 코드는 형제 `ICAROS-api` 저장소에 있습니다. Cognito 리소스가 설정되지 않으면 로그인이 닫힙니다.

## 현재 클라이언트 계약

| 작업 | 요청 | 기대 응답 |
| --- | --- | --- |
| 세션 | `GET /api/admin/session` | `{ok:true,data:{userId,email}}` |
| 로그인 | `GET /api/admin/auth/start` → Cognito → `/api/admin/auth/callback` | HttpOnly 관리자 세션 쿠키 |
| 로그아웃 | `POST /api/admin/logout` | `{ok:true,data:{logoutUrl}}`; 브라우저가 Cognito 로그아웃 URL로 이동 |
| 목록 | `GET /api/admin/content/{rockets\|site\|posts}` | `{ok:true,data:Record[]}` |
| 수정 | `PUT /api/admin/content/{kind}/{id}`, `If-Match: {version}` | `{ok:true,data:updatedRecord}` |
| 게시 | `POST /api/admin/publish` `{kind,id,version,idempotencyKey}` | `{ok:true,data:PublishJob}` |
| 게시 상태 | `GET /api/admin/publish/{id}` | `{ok:true,data:PublishJob}`; `published` 확인 시에만 공개 완료 표시 |
| 기체 갤러리 | `GET/PUT /api/admin/content/vehicles/{rocketId}/gallery` | `{id,version,mediaIds}`; PUT 본문 `{mediaIds}`, `If-Match` 필수 |
| 기체 3D 모델 | `GET/PUT /api/admin/content/vehicles/{rocketId}/model` | `{id,version,modelMediaId,posterMediaId}`; PUT 본문 `{modelMediaId,posterMediaId}`, `If-Match` 필수 |
| 후원 현황 | `GET /api/admin/content/donation-rounds`, `PUT /api/admin/content/donation-rounds/current` | 단일 `{id:'current',version,roundLabel,goal,amount}`; PUT `If-Match` 필수 |
| 미디어 업로드 | `POST /api/admin/media/presign` → signed PUT → `POST /api/admin/media/confirm` | 확인된 media ID만 콘텐츠에 연결 |

수정 본문은 편집 필드만 보냅니다. `ApiResult<T>` 형태를 우선 읽고 현재 API의 `{ok:true,...}` 형태도 처리합니다. 오류는 `{ok:false,error}` 또는 `{ok:false,message}`를 읽고 503을 사용 불가로 표시합니다. 게시 API가 스냅샷 참조와 빌드 소스 리비전을 결정해야 합니다.

기체 갤러리·모델과 후원 현황 편집은 로컬 API 계약에 연결되어 있습니다. 게시 버튼은 저장된 변경 사항 전체를 대상으로 하며, 게시 작업 상태가 `published`일 때만 빌드 완료를 표시합니다. 운영 게시 인프라와 ESSENTIA 게시글 업스트림은 실제 환경에서 검증해야 합니다. 게시글 MP4 첨부는 별도 ESSENTIA 백엔드 작업 브랜치에서 지원하도록 구현했으며, 해당 변경은 아직 운영에 반영되지 않았습니다.
