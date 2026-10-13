# G 운영 artifact 패키징

Node 22 환경에서 승인된 **현재 checkout의 전체 commit SHA**를 사용한다. 작업 트리와 index가 HEAD와 달라지거나 추적되지 않은 소스가 있으면 검증·패키징이 중단된다. 출력은 checkout 바깥의 아직 존재하지 않는 디렉터리에 둔다. 아래 명령은 AWS 배포·게시·포인터 변경을 수행하지 않는다.

```sh
node scripts/package-g-release.mjs "$WEB_SOURCE_SHA" "$VERIFIED_SNAPSHOT_FILE" "$VERIFIED_SNAPSHOT_SHA256" "$WEB_ARTIFACT_DIRECTORY"
```

`VERIFIED_SNAPSHOT_FILE`은 운영 포인터에서 내려받고 SHA-256을 확인한 현재 immutable snapshot이다. synthetic fixture의 파일이나 동일 내용은 거부된다. 입력 내용을 임시 파일로 고정하고 snapshot contract를 검사한 뒤 lockfile로 `npm ci --ignore-scripts`를 수행하고 `infra/g/verify-source.mjs`의 전체 검증을 실행한다. fixture 검증이 끝나면 `.next`, `.open-next`, CMS `dist`를 삭제하고 고정한 운영 snapshot으로 새로 빌드한다. 빌드 전후와 출력 확정 직전에 source SHA와 clean 상태를 다시 확인한다.

`BUILD_ID`는 `SHA256(source SHA + ':' + snapshot SHA256)`이다. Next 설정의 기본 BUILD_ID 생성은 환경변수를 지정하지 않았을 때 유지된다. public wrapper는 lockfile에 고정된 S3 SDK, revalidation wrapper는 Lambda SDK를 Node 22 ESM으로 bundle한다. Revalidation은 IAM Function URL의 unsigned HEAD 대신 SDK의 signed Lambda Invoke를 사용한다. Lambda 런타임이 제공하는 S3/Lambda SDK 버전에 의존하지 않는다.

출력 구성:

| 경로 | 용도 |
| --- | --- |
| `server.zip` | Node 22 / arm64 public Lambda. `index.mjs`는 G wrapper, `open-next-entry.mjs`는 원래 OpenNext entry, `visible-posts.mjs`는 공유 공개 글 필터 |
| `revalidation.zip` | Node 22 / arm64 revalidation Lambda. `index.mjs`는 signed Invoke wrapper이며 `prerender-manifest.json` 등 생성 파일을 함께 포함 |
| `assets/` | OpenNext static assets. 운영 업로드 시 기존 hashed assets도 유지해야 한다 |
| `cache/` | 선택한 snapshot의 초기 OpenNext cache. 운영 cache 경로 적용은 별도 배포 절차에서 결정한다 |
| `cms/` | CMS production `dist` |
| `BUILD_ID` | 두 Lambda 및 cache 설정에 사용할 실제 build ID |
| `release-manifest.json` | source SHA, snapshot SHA, lockfile SHA, S3/Lambda SDK 버전, build ID, 모든 파일의 SHA-256 및 ZIP SHA-256 |

ZIP의 파일 순서·timestamp·permission을 고정한다. 동일 파일 내용에서 동일 ZIP을 만들지만 Next 전체 빌드의 바이트가 다른 플랫폼·Node patch·도구 버전에서도 일치한다고 보장하지 않는다. manifest의 실제 파일/ZIP hash가 배포 검증 기준이다.

API는 형제 API 저장소에서 별도로 패키징한다. 기존 운영 ZIP의 `certs/rds.pem`에 대응하는 검증된 private CA bundle 파일을 입력한다. 운영 식별자나 인증서 파일을 공개 source에 추가하지 않는다.

```sh
node scripts/package-release.mjs "$API_SOURCE_SHA" "$VERIFIED_CA_BUNDLE_FILE" "$API_ARTIFACT_DIRECTORY"
```

API는 clean source 검증, lockfile 기반 build dependencies 재설치, typecheck, lint, 전체 unit test, production dependency audit, 새 build를 거친다. lockfile로 Linux x64 glibc production dependencies를 별도 디렉터리에 설치한다. ZIP은 `dist/handler.js`, `package.json`, `package-lock.json`, `node_modules/`, `certs/rds.pem`을 포함한다. Argon2의 실제 바이너리가 Linux ELF x86_64인지 확인하고 다른 native binary를 거부한다. 산출물은 `api.zip`과 전체 파일/ZIP hash를 담은 `release-manifest.json`이다.

패키징 테스트:

```sh
node --test scripts/package-g-release.test.mjs
# API 저장소에서 실행
node --test scripts/package-release.test.mjs
```

배포 시 manifest SHA를 실제 업로드 ZIP 및 반영된 Lambda code hash와 비교하고, public/CMS smoke 및 mutation 검증을 실행해야 한다. 이 문서의 패키징 명령 성공은 운영 전환 성공을 뜻하지 않는다.
