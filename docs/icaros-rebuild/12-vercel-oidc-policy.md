# 12 — Vercel OIDC 역할 정책안

> **초안이다. 아직 아무것도 만들지 않았다.** IAM 생성·변경은 사용자 승인 사항(D5).
> 근거: DECISIONS D5(OIDC 역할 수임) · D20(RDS IAM 인증) · 07-s3-storage-plan.md §8

## 왜 OIDC 인가

ESSENTIA 에는 **런타임에 장기 키를 두는 곳이 한 군데도 없다** — EC2 는 인스턴스 프로파일,
GitHub Actions 는 OIDC 역할 수임이다. 로컬 `essentia` 프로필은 IAM 사용자 장기 키이고
**로컬 전용**이다. ICAROS 도 같은 원칙을 잇는다.

DB 도 같은 경로를 재사용한다. 이것이 D20 에서 A(정적 비밀번호) 대신 B(IAM 인증)를 택한 이유다 —
자격증명 경로가 하나로 모이고, 폐기가 "비밀번호 교체 + 전 서비스 재배포"가 아니라 IAM 정책 수정이 된다.

## 역할 두 개로 나눈다

| 역할 | 수임 주체 | 권한 |
|---|---|---|
| `icaros-vercel-runtime` | Vercel 런타임(OIDC) | S3 객체 R/W/D(ICAROS 프리픽스), `rds-db:connect` → **`icaros_app` 만** |
| `icaros-deploy-migrate` | 배포 파이프라인 | `rds-db:connect` → **`icaros_migrator` 만**. S3 권한 없음 |

**런타임 역할에 `icaros_migrator` 를 주지 않는다.** 주는 순간 앱 코드가 DDL 을 실행할 수 있게 되고,
`icaros_app` 에서 DDL 권한을 뺀 의미가 사라진다.

## 신뢰 정책 (Vercel OIDC)

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/oidc.vercel.com/<team-slug>" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "oidc.vercel.com/<team-slug>:aud": "https://vercel.com/<team-slug>",
        // 프로젝트·환경까지 좁힌다. 이걸 빼면 같은 팀의 **다른 프로젝트**도 이 역할을 수임한다.
        "oidc.vercel.com/<team-slug>:sub": "owner:<team-slug>:project:icaros-web:environment:production"
      }
    }
  }]
}
```
Preview 환경을 허용하려면 `sub` 를 하나 더 추가한다. `StringLike` 와일드카드는 쓰지 않는다 —
`environment:*` 는 임의의 프리뷰 배포에 프로덕션 권한을 준다.

## 권한 정책 — 런타임

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IcarosPrefixObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<file-bucket>/icaros-web/*"
    },
    {
      // 게시글 이미지는 `/api/forum/image/{name}` 서빙 경로에 걸려야 해서 forum/ 에 들어간다.
      // Posts 를 Community 로 옮기는 경우에만 필요하다 (07 §2).
      "Sid": "ForumImagesConditional",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::<file-bucket>/forum/*"
    },
    {
      // 제한 없는 ListBucket 은 버킷 전체 키 목록을 노출한다. 반드시 prefix 조건을 건다.
      "Sid": "ScopedList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<file-bucket>",
      "Condition": { "StringLike": { "s3:prefix": ["icaros-web/*"] } }
    },
    {
      "Sid": "RdsIamConnectAppRoleOnly",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:ap-northeast-2:<account>:dbuser:<rds-resource-id>/icaros_app"
    },
    {
      // 감사 증적·탈퇴 스냅샷·전자서명·회원 프로필·운영 DB 덤프. 읽기도 주지 않는다.
      // Deny 는 Allow 를 이긴다 — 위 Allow 가 넓어져도 여기서 막힌다.
      "Sid": "DenySensitivePrefixes",
      "Effect": "Deny",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::<file-bucket>/audit/*",
        "arn:aws:s3:::<file-bucket>/withdrawal/*",
        "arn:aws:s3:::<file-bucket>/signatures/*",
        "arn:aws:s3:::<file-bucket>/receipts/*",
        "arn:aws:s3:::<file-bucket>/profileImg/*",
        "arn:aws:s3:::<file-bucket>/db-backup/*"
      ]
    },
    {
      // 정적 웹 버킷은 매 배포마다 `s3 sync --delete` 가 지운다. 통째로 막는다.
      "Sid": "DenyStaticWebBucket",
      "Effect": "Deny",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::<static-web-bucket>", "arn:aws:s3:::<static-web-bucket>/*"]
    }
  ]
}
```

## 권한 정책 — 마이그레이션

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "rds-db:connect",
    "Resource": "arn:aws:rds-db:ap-northeast-2:<account>:dbuser:<rds-resource-id>/icaros_migrator"
  }]
}
```
S3 권한 없음. DB DDL 외에 할 일이 없다.

## 확인 사항

- `<rds-resource-id>` 는 DbiResourceId 다. 인스턴스를 재생성하면 **바뀐다** — 그때 정책도 고쳐야 한다.
- ARN 마지막 세그먼트는 **DB role 이름**이지 IAM 사용자가 아니다. 둘을 헷갈리면 조용히 권한이 안 붙는다.
- `<file-bucket>`·`<static-web-bucket>`·`<account>`·`<team-slug>` 는 아직 받지 않았다. 승인 시점에 채운다.

## 🔴 적용 전 반드시 읽을 것 — `rds_iam` 상속 사고

`essentia_infra` 가 스키마 생성 중 `GRANT icaros_migrator TO CURRENT_USER` 를 실행했는데,
`icaros_migrator` 가 `rds_iam` 을 갖고 있어 **마스터 계정이 그걸 상속받았고 그 순간 비밀번호 인증이 차단**됐다
(`FATAL: PAM authentication failed`). ESSENTIA API 가 약 10분 죽었다.

→ **`rds_iam` 을 가진 role 을 사람·앱 계정에 상속시키지 않는다.**
불가피하면 부여 → 설정 → **같은 트랜잭션에서 즉시 회수**한다.


---

## 🔴 실패 기록 (2026-08-25) — 내가 두 번 틀렸고 프로덕션이 3분 죽었다

이 문서의 초안이 **두 곳에서 잘못돼 있었다.** 그대로 만들어 배포한 결과 `icaros.kr` 이 다운됐다.

### ① 발행자에 팀 경로가 빠졌다
```
초안       oidc.vercel.com
실제 토큰   https://oidc.vercel.com/<team-slug>
```
**Vercel 은 팀별로 발행자 경로를 나눈다.** STS 는 발행자를 정확히 대조하므로
`InvalidIdentityToken: The web identity token provided could not be validated` 가 난다.

추측하지 말고 discovery 문서로 확인할 것:
```
https://oidc.vercel.com/<team-slug>/.well-known/openid-configuration
  → issuer 가 토큰의 iss 와 일치해야 한다
```

### ② 조건 키가 호스트 기준이 아니다 — 스킴만 뺀 **전체 URL(경로 포함)** 이다
```
틀림   oidc.vercel.com:sub
맞음   oidc.vercel.com/<team-slug>:sub
```
EKS IRSA 가 `oidc.eks.<region>.amazonaws.com/id/<ID>:sub` 를 쓰는 것과 같은 규칙이다.

**이게 더 위험한 실수다.** 호스트 기준으로 두면 *존재하지 않는 키* 를 `StringEquals` 로 대조하게 되고,
없는 키는 조건 불충족이라 **조용히 거부**된다. ①만 고쳤다면 에러가 `InvalidIdentityToken` 이 아니라
그냥 `AccessDenied` 라 원인 찾기가 더 어려웠을 것이다.
(`essentia_infra` 가 지시를 그대로 따르지 않고 잡아냈다.)

### ③ 구조적 원인 — 신뢰 정책이 검증 경로를 막았다
`sub` 를 `environment:production` 만 허용해서 **Preview 로 미리 확인할 방법이 없었다.**
확인 없이 프로덕션에 넣을 수밖에 없었고, 그래서 **실패가 곧 다운타임**이 됐다.

→ 런타임 역할에 `preview` `sub` 를 추가했다. 와일드카드가 아니라 **정확히 두 값**을 나열한다.
→ **마이그레이션 역할은 production 만 유지한다.** PR 하나로 트리거되는 환경이 운영 DB 스키마를
   바꿀 수 있으면 Preview 를 좁게 잡은 이유가 무너진다. Preview 는 읽기 검증용이다.

**교훈: 좁은 권한이 검증 경로까지 막으면 안전한 게 아니라 위험을 프로덕션으로 미루는 것이다.**

### 다음 배포 절차
```
1. vercel deploy            (Preview)
2. Preview 에서 DB 읽기 실측
3. 통과하면 vercel promote / --prod
```
2번을 건너뛰지 않는다.
