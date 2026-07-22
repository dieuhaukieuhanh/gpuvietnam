# Gate 1 Continuity — Execution ticket (locked)

| | |
|---|---|
| **Goal** | Chứng minh Architecture v2.0 trên GPU thật — **không** feature mới |
| **Checklist** | [GATE1_CONTINUITY_CHECKLIST.md](./GATE1_CONTINUITY_CHECKLIST.md) |
| **Report** | [GATE1_TEST_REPORT.md](./GATE1_TEST_REPORT.md) (tạo khi chạy xong) |
| **Out of scope** | A0.5 · Frontend Separation · G7 · dual-run T8–T10 · refactor |

---

## Rules

1. Không viết tính năng mới.  
2. Chỉ sửa **bug** chặn G1–G6, rồi chạy lại bài FAIL.  
3. Thiếu env/image/worker → ghi **BLOCKED**, không ghi FAIL kiến trúc.  
4. **G4+G6 = một kịch bản** (kill Provider → Attempt A fail → Runtime B → restore → Generate B).  
5. Gate 1 Continuity PASS chỉ khi **G1–G6 đều PASS**.  
6. Xong → **dừng**, chờ quyết định mở A0.5.

---

## Steps

### 0. Environment gate

| Check | Required |
|-------|----------|
| `SUPABASE_DB_URL` | Apply 0043–0046 |
| `COMFY_PROXY_ENABLED=1` + `COMFY_PROXY_BASE_URL` | work.* |
| Worker deploy có `/gpuvietnam/cp/sync` | G1 sync |
| Origin API reachable từ Worker (`ORIGIN_RESOLVE_URL` / `ORIGIN_API_BASE`) | sync forward |
| CF KV mint (`CF_*`) nếu origin resolve không ổn định | enter workUrl |
| Image registry tag mới có `gpuvietnam_cp_sync` | Máy **mới** sau push |
| Provider key (Vast/Clore) + giờ còn | Rent GPU |
| `NEXT_PUBLIC_APP_URL` / tunnel khớp Worker origin | Bootstrap `apiBase` |

### 1. Migrations

```bash
npm run db:migrate:list
npm run db:migrate -- --only 0043
npm run db:migrate -- --only 0046
# 0044/0045 nếu pending và là deps
```

### 2. Image

Build + push tag test **`:v3.1`** (không ghi đè production `:v3`):

```bash
docker build -f Dockerfile.v3 -t dieuhaukieuhanh/gpuvietnam-comfyui:v3.1 .
docker push dieuhaukieuhanh/gpuvietnam-comfyui:v3.1
```

Image phải có: `gpuvietnam_cp_sync`, branding, backup, Official nodes lock hiện tại.

Env Gate 1: `GPUVIETNAM_COMFYUI_IMAGE_V3=dieuhaukieuhanh/gpuvietnam-comfyui:v3.1`  
Thuê máy **sau** khi `:v3.1` live trên registry.

### 3. Worker

```bash
cd workers/comfy-proxy
npx wrangler deploy
```

Xác nhận route `POST/GET /gpuvietnam/cp/sync` trên bản deploy.

### 4. Run tests

Thứ tự:

1. **G1** sync indicator  
2. **G2** tắt hẳn browser → mở lại  
3. **G3** Stop dashboard → máy mới → graph còn  
4. **G4+G6** kịch bản kill Provider (một lần)  
5. **G5** quan sát banner trong G3 hoặc G4+G6  

Ghi mỗi bài: PASS/FAIL/BLOCKED · bước · log · `workflow_id` / `revision` / `machine_id` / provider order id.

### 5. Report

Tạo `docs/architecture/GATE1_TEST_REPORT.md` với Environment + G1…G6 + kết luận.

---

## Definition of Done

- [ ] `GATE1_TEST_REPORT.md` tồn tại  
- [ ] G1–G6 đều **PASS** trên GPU thật → kết luận **Gate 1 Continuity PASS**  
- [ ] Hoặc FAIL/BLOCKED có đủ nguyên nhân — **không** mở A0.5  
