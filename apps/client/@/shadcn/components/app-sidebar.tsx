import {
  BarChart3,
  Building,
  FileText,
  Globe,
  ListPlus,
  Settings,
  SquareKanban
} from "lucide-react";
import * as React from "react";
import { getCookie } from "cookies-next";

import { NavMain } from "@/shadcn/components/nav-main";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/shadcn/ui/sidebar";
import useTranslation from "next-translate/useTranslation";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import CreateTicketModal from "../../../components/CreateTicketModal";
import ThemeSettings from "../../../components/ThemeSettings";
import { useUser } from "../../../store/session";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const location = useRouter();

  const { loading, user, fetchUserProfile } = useUser();
  const locale = user ? user.language : "en";

  const [keypressdown, setKeyPressDown] = useState(false);

  const { t, lang } = useTranslation("peppermint");
  const sidebar = useSidebar();

  // 语言切换
  const [currentLang, setCurrentLang] = useState(lang || 'zh-CN');

  function changeLanguage(newLocale) {
    setCurrentLang(newLocale);
    // Next.js i18n: 改变 locale 并跳转
    location.push({ pathname: location.pathname }, location.asPath, { locale: newLocale });
    // 保存到后端用户偏好
    const token = getCookie("session") || getCookie("access_token");
    if (token && user) {
      fetch(`/api/v1/auth/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: user.id, name: user.name, email: user.email, language: newLocale }),
      }).catch(() => {});
    }
  }

  if (!user) {
    location.push("/auth/login");
  }

  if (location.pathname.includes("/admin") && user.isAdmin === false) {
    location.push("/");
    alert("You do not have the correct perms for that action.");
  }

  if (user && user.external_user) {
    location.push("/portal");
  }

  const data = {
    teams: [
      {
        name: "Peppermint",
        plan: `version: ${process.env.NEXT_PUBLIC_CLIENT_VERSION}`,
      },
    ],
    navMain: [
      {
        title: t("sl_new_issue"),
        url: ``,
        icon: ListPlus,
        isActive: location.pathname === "/" ? true : false,
        initial: "c",
      },
      {
        title: t("sl_dashboard"),
        url: `/${locale}/`,
        icon: Building,
        isActive: location.pathname === "/" ? true : false,
        initial: "h",
      },
      {
        title: t("sl_documents"),
        url: `/${locale}/documents`,
        icon: FileText,
        isActive: location.pathname === "/documents" ? true : false,
        initial: "d",
        internal: true,
      },
      {
        title: t("sl_issues"),
        url: `/${locale}/issues`,
        icon: SquareKanban,
        isActive: location.pathname.includes("/issues") ? true : false,
        initial: "t",
        items: [
          {
            title: t("open"),
            url: `/${locale}/issues/open`,
            initial: "o",
          },
          {
            title: t("closed"),
            url: `/${locale}/issues/closed`,
            initial: "f",
          },
        ],
      },
      {
        title: t("sl_admin"),
        url: `/${locale}/admin`,
        icon: Settings,
        isActive: false,
        initial: "a",
      },
      {
        title: t("sl_itil"),
        url: `/${locale}/itil`,
        icon: BarChart3,
        isActive: location.pathname === "/itil" ? true : false,
        initial: "i",
      },
    ],
  };

  function handleKeyPress(event: any) {
    const pathname = location.pathname;

    // Check for Ctrl or Meta key to bypass the shortcut handler
    if (event.ctrlKey || event.metaKey) {
      return; // Don't override browser shortcuts
    }

    if (
      document.activeElement!.tagName !== "INPUT" &&
      document.activeElement!.tagName !== "TEXTAREA" &&
      !document.activeElement!.className.includes("ProseMirror") &&
      !pathname.includes("/new")
    ) {
      switch (event.key) {
        case "c":
          setKeyPressDown(true);
          break;
        case "h":
          location.push("/");
          break;
        case "d":
          location.push(`/${locale}/documents`);
          break;
        case "t":
          location.push(`/${locale}/issues`);
          break;
        case "a":
          location.push(`/${locale}/admin`);
          break;
        case "i":
          location.push(`/${locale}/itil`);
          break;
        case "o":
          location.push(`/${locale}/issues/open`);
          break;
        case "f":
          location.push(`/${locale}/issues/closed`);
          break;
        case "[":
          sidebar.toggleSidebar();
          break;

        default:
          break;
      }
    }
  }

  useEffect(() => {
    // attach the event listener
    document.addEventListener("keydown", handleKeyPress);

    // remove the event listener
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [handleKeyPress, location]);

  return (
    <Sidebar collapsible="icon" {...props} >
      <SidebarHeader>
        {/* <TeamSwitcher teams={data.teams} /> */}
        <div className="flex items-center gap-2 ">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg text-sidebar-primary-foreground">
            <img src="/favicon/favicon-32x32.png" className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold text-xl">Peppermint</span>
            <span className="truncate text-xs">
              version: {process.env.NEXT_PUBLIC_CLIENT_VERSION}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <CreateTicketModal
          keypress={keypressdown}
          setKeyPressDown={setKeyPressDown}
        />
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2">
          <div className="flex items-center gap-2 text-sm text-sidebar-foreground/70 px-2 py-1">
            <Globe className="size-4" />
            <select
              value={currentLang}
              onChange={(e) => changeLanguage(e.target.value)}
              className="bg-transparent border-none text-sm outline-none cursor-pointer w-full"
            >
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        <div className="hidden sm:block mt-1">
          <ThemeSettings />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
