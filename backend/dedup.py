"""
一次性去重脚本：清理因「补填抖音号导致 uid 变化」产生的重复博主记录。

判定：同一「姓名+电话」对应多条记录即为重复。
保留策略：优先保留 uid 已是 np:（姓名+电话）的那条；否则保留 created_at 最早的。
照片：合并到保留记录（保留记录无照片时，取被删记录的照片）。

用法（在 backend 目录，用 venv 的 python）：
  ./venv/bin/python dedup.py           # 预览将要处理的重复（不改数据）
  ./venv/bin/python dedup.py --apply   # 实际执行去重
"""
import sys
from collections import defaultdict

from sqlalchemy import select, text

from db import SessionLocal, Kol


def main(apply: bool) -> None:
    with SessionLocal() as session:
        rows = session.execute(
            select(Kol.uid, Kol.phone, Kol.name, Kol.douyin_id, Kol.created_at)
        ).all()

        # 按「姓名+电话」分组（两者都空的跳过）
        groups: dict[str, list] = defaultdict(list)
        for r in rows:
            name = (r.name or "").strip()
            phone = (r.phone or "").strip()
            if name or phone:
                groups[f"{name}|{phone}"].append(r)

        dup_groups = {k: rs for k, rs in groups.items() if len(rs) > 1}

        if not dup_groups:
            print("没有发现重复记录（按姓名+电话判定）。")
            return

        print(f"发现 {len(dup_groups)} 组重复（按姓名+电话）：")
        total_deleted = 0

        for key, rs in dup_groups.items():
            # 排序：uid 是 np:（姓名+电话）的优先保留，其次 created_at 最早
            def sort_key(r):
                is_np = 1 if (r.uid or "").startswith("np:") else 0
                created = r.created_at or ""
                return (-is_np, str(created))

            rs_sorted = sorted(rs, key=sort_key)
            keep = rs_sorted[0]
            drop = rs_sorted[1:]

            print(f"\n  {key}：")
            print(f"    保留 {keep.uid}（{keep.name}）")
            for d in drop:
                print(f"    删除 {d.uid}（{d.name}）")
                total_deleted += 1

            if apply:
                for d in drop:
                    has_keep_photo = session.execute(
                        text("SELECT 1 FROM kol_photo WHERE uid = :u"), {"u": keep.uid}
                    ).first()
                    if has_keep_photo:
                        session.execute(
                            text("DELETE FROM kol_photo WHERE uid = :u"), {"u": d.uid}
                        )
                    else:
                        session.execute(
                            text("UPDATE kol_photo SET uid = :new WHERE uid = :old"),
                            {"new": keep.uid, "old": d.uid},
                        )
                    session.execute(text("DELETE FROM kol WHERE uid = :u"), {"u": d.uid})

        if apply:
            session.commit()
            print(f"\n已完成去重，删除 {total_deleted} 条重复记录。")
        else:
            print(f"\n[预览] 将删除 {total_deleted} 条重复记录。加 --apply 实际执行。")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
