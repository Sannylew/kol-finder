import { Navigate } from "react-router-dom";
import { getToken } from "../api";

/** 后台路由守卫：无 token 跳登录。 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}
