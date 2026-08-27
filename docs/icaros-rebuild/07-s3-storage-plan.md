# 07 — S3 Storage Plan

> 근거: `essentia_infra` 회신 2/2 (2026-08-23). 식별자·정책 원문은 전달받지 않았고 구조만 확인.
> AWS `essentia` 프로필 read-only 확인 완료: Account `009144422504` · `ap-northeast-2` · `iam::user/Kunwoo_Kim`.
> 상태: **전 항목 확정** (`DECISIONS.md` D3·D4·D5·D6). 버킷·IAM·CORS 변경 **일절 미실시**.

---

## 0. 판을 바꾸는 사실 4가지

| # | 사실 | 결과 |
|---|---|---|
| 1 | **ESSENTIA에 "공개 읽기" 객체 클래스가 아예 없다.** 회원 프로필 사진 포함 전부 private, Public Access Block 4개 전부 ON | 우리가 "공개 이미지"를 만들려면 **전례 없는 새 인프라**(CloudFront 배포)를 세워야 한다 |
| 2 | **Versioning이 꺼져 있다** (의도된 결정) | **덮어쓰거나 지우면 복구 불가.** 52객체 이관에서 가장 위험한 사실 |
| 3 | **이미지 리사이즈 파이프라인이 없다.** 대신 **브라우저에서 업로드 전에 끝낸다** — canvas → WebP, 긴 변 512px, q0.85, 2MB 상한. 서버는 `image/webp`만 수락 | 우리 86.67 MiB 문제는 **같은 방식으로 입구에서 막는 것**이 관례 일치 |
| 4 | **프리픽스 포함관계로 교차 삭제 사고 전력**이 있다 (3차 보안감사 지적) | ICAROS 프리픽스는 기존 이름의 **접두사가 되면 안 된다**. `s3 rm --recursive` 금지 |

---

## 1. 버킷 지형

| 버킷 | 용도 | ICAROS |
|---|---|---|
| **파일 버킷** | 운영 업로드. 기존 프리픽스: `archive/` `archive/img/` `audit/` `forum/` `hero/` `plans/` `profileImg/` `projects/` `projects/content/` `receipts/` `signatures/` `withdrawal/` | **전용 프리픽스 신설** |
| **정적 웹 버킷** | 프론트 산출물. CloudFront OAC 전용 | **절대 금지** — 매 배포마다 `s3 sync --delete`가 지운다 |

암호화: **SSE-S3 (AES256)**, 버킷 키 비활성, SSE-C 차단. 우리는 별도 설정 없이 같은 기본값을 받는다.
Lifecycle: 미완성 멀티파트 7일 정리 1건뿐. 만료·전환 규칙 없음.

---

## 2. 🔴 게시글 이미지는 ICAROS 프리픽스가 아니다

Posts를 ESSENTIA Community로 옮기면(`05-database-plan.md` §4 선택지 A/C), **그 이미지는 `forum/`에 들어가야** `/api/forum/image/{name}` 서빙 경로에 걸린다.

→ **미디어·GLB만 ICAROS 프리픽스, 게시글 이미지는 `forum/`.**
→ 즉 **S3 프리픽스 결정이 Posts 연동 방식 결정에 종속**된다. Posts가 B(읽기 전용)로 가면 우리는 `forum/`에 쓸 일이 없고, IAM 조건부 권한도 필요 없어진다.

---

## 3. 권장 설계 — "공개 클래스를 만들지 않는다"

### 판단
마스터 프롬프트는 "공개 콘텐츠 전달에 CloudFront 또는 presigned GET"을 열어 뒀지만, 세 가지 사실이 한 방향을 가리킨다.

1. ESSENTIA에 공개 클래스 전례가 **없다** → 만들면 우리가 유일한 예외가 되고, 그 예외를 우리가 운영해야 한다
2. CloudFront signed URL/cookie **구현체도 없다** → "공개 CloudFront"를 만들면 접근 통제가 필요해질 때 다시 막힌다
3. 멤버 사진이 **미성년자 얼굴**이다 → 실수의 대가가 크다

**→ 전부 private으로 두고, ICAROS 앱의 route handler가 302로 presigned GET에 넘긴다.**
ESSENTIA `/api/forum/image/{name}`이 정확히 이 패턴이고 이미 검증됐다.

### 이 선택이 `next/image` 문제까지 같이 푼다

```
<Image src="/api/media/{id}" … />
        │
        └─ Next 이미지 최적화기가 서버사이드로 fetch
             └─ 우리 route handler → 302 → presigned GET (10분)
                  └─ 바이트 수신 → 최적화 → 캐시
```

핵심은 **`/api/media/{id}`가 안정적인 URL**이라는 것이다. presigned URL을 `src`에 직접 넣으면 5~10분마다 URL이 바뀌어 최적화 캐시가 매번 miss 나고 서명 쿼리스트링이 캐시 키를 오염시킨다. 프록시를 한 겹 두면 캐시 키가 고정된다.

부수 효과: 이 route handler에 **접근 통제를 얹을 수 있다.** 멤버 사진 요구사항이 별도 메커니즘 없이 해결된다.

비용: 캐시 미스 시 이미지 바이트가 Vercel 함수를 통과한다. 업로드 시점에 512px WebP로 줄이므로(§5) 실질 부담은 작다.

**기각한 대안**: 공개 클래스용 CloudFront 신설 — 새 배포 필요, 기존 배포는 정적 사이트 전용이고 OAC가 그 버킷에 묶여 있어 재사용 불가. 우리가 유일한 사용자가 되는 인프라를 늘리는 값을 하지 못한다.

### presigned TTL
ESSENTIA 관례를 그대로 따른다.

| 용도 | TTL |
|---|---|
| 프로필·게시판 이미지 | **10분** |
| 자료실 다운로드·영수증류 | 5분 |
| **ICAROS 멤버 사진 · 로켓 이미지 · GLB** | **10분** |

---

## 4. 프리픽스 · 키 규칙

기존 이름의 접두사가 되지 않는 새 이름을 쓴다(§0-4). **이름 자체는 사용자 결정.**

```
{icaros-prefix}/
  media/{uuid}.webp      ← 로켓 이미지, 멤버 사진, 랜딩 이미지, OG
  glb/{uuid}.glb         ← 3D 모델
  poster/{uuid}.webp     ← 3D 포스터 (WebGL 미가용 시 대체)
  temp/{uuid}.{ext}      ← 업로드 검증 전 (lifecycle 정리 대상)
```
게시글 이미지는 여기가 아니라 `forum/{uuid}.webp` (§2).

규칙:
- **사용자 입력 파일명을 키에 넣지 않는다.** UUID만. (ESSENTIA는 구분자가 남아 있으면 거부하도록 코드에 명시돼 있다)
- 원본 파일명은 `icaros.media.original_filename` 컬럼에 보관하고 다운로드 시 `Content-Disposition`으로만 쓴다
- 대문자 확장자 정규화 — 레거시에 `.PNG` 2건 있음. **S3 키는 대소문자 구분** (`08-migration-plan.md` J12)
- `…/pub/` 과 `…/priv/` 로 두 갈래를 나눌 필요는 **없다** — §3에서 공개 클래스를 만들지 않기로 했으므로 전부 private 단일 클래스다. 나중에 공개 클래스가 생기면 그때 서로의 접두사가 아닌 이름으로 분리한다.

---

## 5. 업로드 파이프라인

### 브라우저 전처리 (ESSENTIA 관례 채택)
```
파일 선택
  → canvas 디코드
  → 긴 변 512px로 축소       (로켓 대표 이미지·GLB 포스터는 1600px로 상향 검토)
  → WebP 인코딩 q0.85
  → 2MB 초과 시 거부
  → SVG 차단 (MIME + 확장자 이중 검사)
```
서버는 `image/webp`만 수락한다 → **원본 대용량이 애초에 S3에 도달하지 않는다.**
현행 최대 9.7 MB / 21개가 2 MiB 초과인 문제가 입구에서 사라진다.

> ⚠ 512px는 ESSENTIA의 프로필·게시판 기준이다. ICAROS 로켓 대표 이미지와 3D 포스터는 더 커야 한다.
> **1600px를 q0.85로 인코딩하면 2MB를 넘을 수 있다.** 고정 품질 대신 **품질 단계 하향 루프**를 쓴다 — q0.85에서 시작해 상한 이하가 될 때까지 0.05씩 낮추고, q0.60에서도 초과하면 거부.
> 상한: `media` **1MB** / `hero`·`poster` **2MB**.

### GLB
브라우저 전처리 불가. 빌드타임 `@gltf-transform/cli`로 Draco 또는 meshopt 압축 후 업로드.
현재 소스 `icx-2.fbx` **16 MB** → FBX→GLB 변환 + 압축 필요. 업로드 상한은 별도로 정한다(제안: 8 MB).

### 서버 흐름 (원자성 없음 → 보상 처리)
```
1. icaros.media 행 생성  status='pending'
2. presigned PUT 발급    (허용 prefix·MIME·크기 조건 서버가 강제)
3. 브라우저 → S3 직접 PUT
4. /confirm 호출 → 서버가 HeadObject로 실재·크기·ETag 검증
5. status='ready' + entity 연결
6. 실패·미확정 건은 cleanup job이 회수
```
`icaros.media`에 저장: `bucket` · `key` · `original_filename` · `mime` · `size` · `etag` · `width` · `height` · `entity_type` · `entity_id` · `status` · `created_at` · `deleted_at`.

**presigned PUT vs POST → PUT 채택** (`DECISIONS.md` D12).
POST의 `content-length-range`가 크기 상한을 서명에 박을 수 있어 기술적으로는 더 강하다. 그러나 **버킷은 ESSENTIA와 공유하는 자원**이고 ESSENTIA는 이미 presigned PUT + `content-type;host` 서명으로 타입을 강제한다. POST를 열면 같은 버킷에 검증 모델이 두 개 생긴다.
→ 크기 상한은 ① 브라우저 전처리(§5) ② `/confirm`의 `HeadObject` 검증 후 초과 시 즉시 삭제 로 담보한다. 남는 위험은 전송 중 대역폭뿐이고, 업로더는 이미 인증된 관리자다.

---

## 6. 삭제 — Versioning이 꺼져 있다

**복구 수단이 없다.** 규칙을 강하게 건다.

- `s3 rm --recursive` · `deleteObjects` 프리픽스 일괄 **전면 금지**
- 삭제 전 `icaros.media`에서 **소유 검증** — 그 키가 ICAROS 프리픽스이고, 우리 행에 등록돼 있고, 어떤 entity도 참조하지 않을 때만
- 삭제는 개별 키 단위 `DeleteObject`만
- 삭제 실패는 예외를 삼키지 않고 `icaros.storage_cleanup_jobs`에 적재 → 재시도 가능
- **이관 중에는 아무것도 지우지 않는다.** Supabase → S3는 복사이고, Supabase 폐기는 검증 완료 후 별도 단계다

---

## 7. CORS — 현재 우리 오리진이 없다

파일 버킷 현행:

| 항목 | 값 | ICAROS 영향 |
|---|---|---|
| 허용 메서드 | `GET` `PUT` `HEAD` | **충분. 변경 불필요** (D12로 POST 철회) |
| `AllowedHeaders` | `*` | 충분 |
| `ExposeHeaders` | **`ETag` 하나뿐** | **GLB Range 요청 시 `Content-Range`·`Accept-Ranges` 추가 필요** |
| `AllowedOrigins` | 로컬 2 + ESSENTIA 운영 2 | **ICAROS Vercel 도메인 없음 → 추가 필요** |

주의:
- **presigned GET이어도 버킷 CORS 규칙이 그대로 적용된다.** 서명이 CORS를 대신하지 않는다.
- Draco/meshopt wasm 디코더는 Vercel에서 서빙하므로 이 CORS와 무관하다.
- Vercel 프리뷰는 배포마다 도메인이 바뀐다 → **와일드카드 허용 여부는 사용자 결정.**
  권장: 프로덕션 도메인 + `https://*.vercel.app`은 **넣지 않는다**(다른 사람의 Vercel 앱도 포함된다).
  프리뷰 검증이 필요하면 고정 프리뷰 별칭 도메인 1개를 지정해 그것만 추가한다.

**필요한 변경 2건 (승인 전 미실시)**: `ExposeHeaders`에 `Content-Range`·`Accept-Ranges` 추가 · ICAROS 오리진 추가.

---

## 8. IAM

### 런타임 인증 — OIDC 권장
- 로컬 `essentia` 프로필은 **IAM 사용자 장기 키**다. **로컬 전용이며 ICAROS 런타임에 절대 쓰지 않는다.**
- ESSENTIA에는 런타임에 장기 키를 두는 곳이 **한 군데도 없다** (EC2는 인스턴스 프로파일, GHA는 OIDC 역할 수임).
- → Vercel도 **AWS OIDC 페더레이션으로 역할 수임**. IAM user access key는 최후 수단.
- **IAM 생성·변경은 사용자 승인 사항.** `essentia_infra`는 아무것도 만들지 않았고, 나도 만들지 않는다.

### 권한 범위 (승인 전까지 문서로만)

| | 대상 |
|---|---|
| **허용** | ICAROS 전용 프리픽스에 대한 객체 `GetObject`·`PutObject`·`DeleteObject`, 해당 프리픽스로 제한된 `ListBucket` |
| **조건부** | Posts를 Community로 옮기는 경우에 **한해** `forum/` 읽기·쓰기 (§2). Posts가 읽기 전용(B)이면 **불필요** |
| **차단** | 정적 웹 버킷 **전체** · `audit/` · `withdrawal/` · `signatures/` · `receipts/` · `profileImg/` |

앞의 셋(`audit/`·`withdrawal/`·`signatures/`)은 감사 증적·탈퇴 스냅샷·전자서명이다. **읽기도 주지 않는다.**

`ListBucket`은 `s3:prefix` 조건으로 반드시 제한한다 — 제한 없는 `ListBucket`은 버킷 전체 키 목록을 노출한다.

---

## 9. 레거시 52객체 이관

| 항목 | 값 |
|---|---|
| 총량 | 52 objects / **86.67 MiB** (전부 `posts/` 아래) |
| 참조됨 | 49 |
| 고아 | 3 (1개는 참조본과 바이트 동일 중복) → **이관 제외** |
| 2 MiB 초과 | 21개, 최대 9.7 MB |
| 대문자 `.PNG` | 2개 → 키 정규화 |
| 로컬 레포 경로 | 8건 (로켓 4 + 멤버 4) — Storage가 아니라 `public/`의 파일. **별도 업로드 경로** |

절차:
1. Supabase Storage → 로컬 다운로드, 체크섬 기록
2. **일회성 배치 변환** — WebP 512px(또는 용도별 상한), 2MB 이하로. 원본은 별도 보관
3. 목적지 결정: 게시글 이미지 → `forum/` (Posts가 A/C인 경우) / 그 외 → `{icaros-prefix}/media/`
4. 업로드 → `HeadObject`로 크기·ETag 검증
5. 본문 마크다운의 URL 치환 — Supabase public URL → 새 서빙 경로
6. 렌더 검증 후에만 Supabase 폐기 (`08-migration-plan.md`)

**이관 중 기존 객체를 덮어쓰지 않는다.** Versioning이 꺼져 있어 되돌릴 수 없다.

---

## 10. 사용자 결정

| # | 결정 | 권장 |
|---|---|---|
| S1 | ~~프리픽스 이름~~ | ✅ **`icaros-web/` 확정** (D4) |
| S2 | ~~공개 클래스 CloudFront~~ | ✅ **신설하지 않음. 전부 private + 302 프록시 확정** (D3) |
| S3 | ~~CORS 오리진 범위~~ | ✅ **프로덕션 도메인 + 고정 프리뷰 별칭 1개. `*.vercel.app` 금지** (D6) |
| S4 | ~~Vercel 런타임 AWS 인증~~ | ✅ **OIDC 역할 수임 확정** (D5) |
| S5 | GLB 업로드 상한 | ✅ **8 MB** |
| S7 | presigned 방식 | ✅ **PUT** — ESSENTIA와 동일 (D12) |
| S6 | 이미지 축소 상한 | ✅ **`media` 512px / `hero`·`poster` 1600px, 공통 2MB** |

## 11. 미해결
- `createPresignedPost`의 `Conditions` 배열 정확한 형태 — 구현 시 AWS API 레퍼런스 직접 확인
- Vercel OIDC ↔ AWS IAM 페더레이션 지원 여부 — `04-architecture.md`에서 `[unverified]`
- 실제 버킷 이름·계정 식별자 — 필요 시점에 사용자가 직접 전달
