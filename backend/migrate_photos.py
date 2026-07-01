"""
照片迁移工具：把旧部署（PostgreSQL 版）的照片关联导入到新的 SQLite 库。

背景：新旧版 uid 规则一致（姓名+电话 np:...），照片按 uid 关联。
迁移只需把旧库 kol_photo 表的 (uid, filename) 导入新 SQLite，
并确保 backend/uploads/ 下有对应图片文件即可。

步骤：
  1) 在【旧服务器】导出照片映射为 CSV：
     docker exec kol_postgres psql -U kol kol_finder -At -F',' \
       -c "SELECT uid, filename FROM kol_photo" > photo_map.csv
  2) 把 photo_map.csv 和旧的 backend/uploads/ 目录复制到【新服务器】的 backend/ 下
  3) 在新服务器 backend 目录运行：
     ./venv/bin/python migrate_photos.py photo_map.csv

说明：
  - 只导入 uploads/ 里确实存在对应图片文件的记录（缺文件的跳过并提示）
  - 已存在的 uid 照片记录会被更新为新文件名
  - 幂等：可重复运行
"""
import sys
from datetime import datetime
from pathlib import Path

import photos  # 触发建表 + 复用 KolPhoto/SessionLocal
from photos import KolPhoto, SessionLocal, UPLOAD_DIR


def main(csv_path: str) -> None:
    p = Path(csv_path)
    if not p.exists():
        print(f"找不到映射文件：{csv_path}")
        sys.exit(1)

    photos.init_photo_table()

    imported = skipped_missing = 0
    now = datetime.now()

    with SessionLocal() as session:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or "," not in line:
                continue
            uid, _, filename = line.partition(",")
            uid = uid.strip()
            filename = filename.strip()
            if not uid or not filename:
                continue

            # 校验图片文件是否存在
            if not (UPLOAD_DIR / filename).exists():
                print(f"  跳过（缺图片文件）：{uid} -> {filename}")
                skipped_missing += 1
                continue

            row = session.get(KolPhoto, uid)
            if row:
                row.filename = filename
                row.updated_at = now
            else:
                session.add(KolPhoto(uid=uid, filename=filename, updated_at=now))
            imported += 1
        session.commit()

    print(f"\n导入完成：成功 {imported} 条，跳过（缺文件）{skipped_missing} 条。")
    print("提示：重新从金山同步博主数据后，照片会按 uid 自动对应显示。")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法：python migrate_photos.py <photo_map.csv>")
        sys.exit(1)
    main(sys.argv[1])
