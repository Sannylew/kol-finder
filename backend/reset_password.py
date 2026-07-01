"""
管理员忘记密码 —— 命令行重置工具。

能访问本机/数据库的人才能运行，安全可控。

用法：
  python reset_password.py                      # 交互式输入新密码
  python reset_password.py 新密码                # 直接重置 admin
  python reset_password.py 用户名 新密码          # 指定用户名重置
"""
import getpass
import sys

import auth


def main():
    args = sys.argv[1:]
    if len(args) >= 2:
        username, new_pwd = args[0], args[1]
    elif len(args) == 1:
        username, new_pwd = auth.DEFAULT_USERNAME, args[0]
    else:
        username = input(f"用户名（默认 {auth.DEFAULT_USERNAME}）: ").strip() or auth.DEFAULT_USERNAME
        new_pwd = getpass.getpass("新密码（至少 6 位）: ").strip()
        confirm = getpass.getpass("再次输入新密码: ").strip()
        if new_pwd != confirm:
            print("[X] 两次输入不一致，已取消")
            return

    # 确保表已创建
    auth.init_auth()

    try:
        auth.reset_password(username, new_pwd)
    except ValueError as e:
        print(f"[X] {e}")
        return

    print(f"[OK] 已重置「{username}」的密码。该账号此前的登录令牌已全部失效，请重新登录。")


if __name__ == "__main__":
    main()
