// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { getCookie } from "cookies-next";

export default function ITILDashboard() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 获取当前主题
  const getTheme = useCallback(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("theme") || "light";
  }, []);

  const [themeParam, setThemeParam] = useState("");

  useEffect(() => {
    setThemeParam(getTheme());
  }, [getTheme]);

  // 监听主题变化 → 发给 iframe
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const newTheme = getTheme();
      setThemeParam(newTheme);
      // 通过 postMessage 实时同步
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "themeChange", theme: newTheme },
          "*"
        );
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [getTheme]);

  // 权限检查
  useEffect(() => {
    const sessionCookie = getCookie("access_token") || getCookie("session");
    if (sessionCookie) {
      setAuthorized(true);
    } else {
      router.push("/auth/login");
    }
  }, [router]);

  // iframe 加载后立即发送当前主题
  const onIframeLoad = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "themeChange", theme: getTheme() },
        "*"
      );
    }
  };

  if (!authorized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-400">验证中...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* 顶栏 */}
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

      {/* iframe - 嵌入 ITIL 仪表盘，传主题作为 URL 参数 */}
      <iframe
        ref={iframeRef}
        src={`http://localhost:4000/?theme=${themeParam}`}
        onLoad={onIframeLoad}
        className="flex-1 w-full border-0"
        title="ITIL Dashboard"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}
