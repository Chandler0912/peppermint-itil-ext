// @ts-nocheck
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getCookie } from "cookies-next";

export default function ITILDashboard() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // 简单权限检查：确认用户已登录
    const sessionCookie = getCookie("access_token") || getCookie("session");
    if (sessionCookie) {
      setAuthorized(true);
    } else {
      router.push("/auth/login");
    }
  }, []);

  if (!authorized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-400">验证中...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* 顶栏 - 与 Peppermint 风格统一 */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <img src="/favicon/favicon-32x32.png" className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              📊 ITIL 仪表盘
            </h1>
            <p className="text-xs text-gray-500">
              ITIL 工单分析 · SLA 监控 · 智能分类
            </p>
          </div>
        </div>
        <a
          href="http://localhost:4000"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          新窗口打开
        </a>
      </div>

      {/* iframe - 嵌入 ITIL 微服务 */}
      <iframe
        src="http://localhost:4000"
        className="flex-1 w-full border-0"
        title="ITIL Dashboard"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}
