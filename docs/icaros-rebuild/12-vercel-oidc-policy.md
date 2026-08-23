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
    "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/oidc.vercel.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "oidc.vercel.com:aud": "https://vercel.com/<team-slug>",
        // 프로젝트·환경까지 좁힌다. 이걸 빼면 같은 팀의 **다른 프로젝트**도 이 역할을 수임한다.
        "oidc.vercel.com:sub": "owner:<team-slug>:project:icaros-web:environment:production"
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
