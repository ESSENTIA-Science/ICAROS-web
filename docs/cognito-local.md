# CMS Cognito 로그인 준비

기존 Cognito App Client에 로컬·운영 callback과 sign-out URL을 등록했고, 공개 가입을 끄고 관리자 그룹을 준비했다. 실제 식별자는 Git에서 제외되는 `docs/.local/cognito.env`에만 둔다. 관리자 사용자를 그룹에 배정하고 같은 이메일의 로컬 DB 권한을 연결해야 로그인할 수 있다. API 저장소는 형제 경로 `../ICAROS-api`에 두고 각 저장소에서 `npm ci`를 실행한다.

1. `essentia` AWS profile의 사용할 region에 CMS 전용 Cognito User Pool을 준비한다. 공개 가입은 끄고 관리자만 등록한다.
2. 관리자 그룹을 만들고 관리자 사용자에게 배정한다. 사용자의 확인된 이메일은 로컬 `icaros.admin_users.email`과 같아야 한다.
3. client secret 없는 public App Client와 managed login 도메인을 설정한다. OAuth는 authorization code grant, `openid email` scope, PKCE(S256)를 사용한다. 로컬 callback URL은 `http://127.0.0.1:5175/api/admin/auth/callback`, sign-out URL은 `http://127.0.0.1:5175/admin/`로 등록한다.
4. 무시되는 `docs/.local/cognito.env`에 다음 환경변수를 넣는다. 값은 실제 리소스에서 읽고 이 문서나 Git에 기록하지 않는다.

```bash
COGNITO_USER_POOL_ID=...
COGNITO_CLIENT_ID=...
COGNITO_DOMAIN=https://...
COGNITO_CALLBACK_URL=http://127.0.0.1:5175/api/admin/auth/callback
COGNITO_ADMIN_GROUP=ICAROS-admin
COGNITO_LOCAL_ADMIN_EMAIL=...
```

여러 관리자 이메일은 `COGNITO_LOCAL_ADMIN_EMAILS`에 쉼표로 구분해 설정한다. 두 변수가 함께 있으면 복수 설정을 우선한다. 임시 비밀번호는 추적하지 않는 `docs/.local/cognito-admin-credentials.json`에 저장하며 첫 로그인에서 직접 변경한다. 초대 메일 발송은 사용자 요청 시 AWS CLI의 `admin-create-user`로 진행하고 기존 임시 사용자는 `RESEND`를 사용한다. `dev.sh`는 메일을 발송하지 않는다.

5. `./dev.sh`를 실행한다. `COGNITO_LOCAL_ADMIN_EMAIL`이 설정됐을 때만 로컬 DB에 해당 이메일의 관리자 매핑을 생성한다. 기존 행의 활성 상태나 비밀번호는 바꾸지 않는다. `/admin/`의 버튼은 Cognito로 이동하며, callback 후 API가 검증된 ID token의 그룹·이메일을 확인하고 짧은 HttpOnly 세션을 만든다.

로컬 CMS는 callback에 설정된 origin으로 주소를 통일한다. `localhost`로 접속하더라도 설정이 `127.0.0.1`이면 그 주소로 이동해 OAuth cookie가 callback에서 유지된다.

미인증 상태로 `/admin/`에 접근하면 세션 확인 후 Cognito로 자동 이동한다. API 장애 시에는 오류와 재시도 링크를 표시한다. User Pool의 MFA는 꺼져 있으며, 각 관리자는 최초 로그인에서 임시 비밀번호를 변경한다.

AWS CLI 조회·설정 작업은 항상 `--profile essentia`를 명시한다. 운영 리소스 생성·변경, 운영 DB 마이그레이션과 배포는 이 로컬 준비 절차에 포함되지 않는다.

운영에서는 CMS와 `/api/admin/*`가 같은 HTTPS origin에 있어야 한다. API Gateway 앞의 라우터는 `/api/admin/auth/start`와 `/api/admin/auth/callback`을 API Lambda로 전달해야 한다. 운영 callback·sign-out URL을 Cognito App Client에 별도로 등록하고 `ADMIN_ALLOWED_ORIGINS`도 정확한 CMS origin으로 설정한다.
