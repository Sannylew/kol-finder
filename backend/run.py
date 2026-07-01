"""
后端启动入口：固定绑定 127.0.0.1:8000（仅本机访问）。

用法：
  python run.py
然后浏览器打开 http://127.0.0.1:8000/docs
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
    )
