"use client";

import {
  BarChart3,
  BookOpen,
  Columns3,
  FileSearch,
  Github,
  Inbox,
  Menu,
  Moon,
  Network,
  ReceiptText,
  Sun,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { QuickJump } from "./QuickJump";

import { GITHUB_URL } from "@/lib/site";

const MAIN = [
  { href: "/", label: "Overview", icon: BarChart3 },
  { href: "/receipts/", label: "Receipt checker", icon: ReceiptText },
  { href: "/queue/", label: "Review queue", icon: Inbox },
  { href: "/search/", label: "Filing search", icon: FileSearch },
  { href: "/compare/", label: "Compare methods", icon: Columns3 },
];
const WORKSPACE = [
  { href: "/architecture/", label: "Architecture", icon: Network },
  { href: "/about/", label: "Data & licences", icon: BookOpen },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  const root = href.split("/")[1];
  return path.startsWith(`/${root}`);
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="mocha-grad grid h-9 w-9 place-items-center rounded-xl text-[15px] font-extrabold text-white shadow-card">Σ</span>
      <span className="text-[19px] font-extrabold tracking-tight text-ink">
        Sum<span className="text-mocha">Proof</span>
      </span>
    </Link>
  );
}

function NavList({ items, path, onNavigate }: { items: typeof MAIN; path: string; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium transition-colors ${
                active ? "bg-surface-solid text-mocha-deep shadow-card" : "text-ink hover:bg-surface-solid/60 hover:text-ink"
              }`}
            >
              <Icon size={19} strokeWidth={1.8} className={active ? "text-mocha" : "text-muted"} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Sidebar({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-7 p-5">
      <Logo />
      <nav aria-label="Main" className="flex flex-col gap-2">
        <p className="px-3 text-[11.5px] font-semibold tracking-[0.12em] text-muted uppercase">Main menu</p>
        <NavList items={MAIN} path={path} onNavigate={onNavigate} />
      </nav>
      <nav aria-label="Workspace" className="flex flex-col gap-2">
        <p className="px-3 text-[11.5px] font-semibold tracking-[0.12em] text-muted uppercase">Workspace</p>
        <NavList items={WORKSPACE} path={path} onNavigate={onNavigate} />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium text-ink hover:bg-surface-solid/60 hover:text-ink"
        >
          <Github size={19} strokeWidth={1.8} className="text-muted" />
          Source code
        </a>
      </nav>
      <div className="mt-auto rounded-2xl border border-line bg-surface-solid p-4 text-center shadow-card">
        <p className="text-[14px] font-bold text-ink">Explorer mode</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Real outputs from the evaluation runs. Live mode runs the models on a local GPU.
        </p>
        <span className="mocha-grad mt-3 inline-block rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white">
          $0 · open models
        </span>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("sumproof-theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface-solid text-ink shadow-card hover:text-mocha"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="relative z-10 mx-auto max-w-[1480px] px-0 py-0 sm:px-4 sm:py-5 lg:px-6 lg:py-6">
      <div className="glass relative flex min-h-[calc(100vh-3rem)] overflow-hidden border-line shadow-card sm:rounded-[28px] sm:border">
        <aside className="hidden w-[260px] shrink-0 border-r border-line lg:block">
          <div className="sticky top-0 h-[calc(100vh-3rem)]">
            <Sidebar path={path} />
          </div>
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button className="absolute inset-0 bg-black/30" aria-label="Close navigation" onClick={() => setOpen(false)} />
            <div className="glass relative h-full w-[280px] border-r border-line bg-surface-solid">
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="absolute top-5 right-4 grid h-9 w-9 place-items-center rounded-full text-muted hover:text-ink"
              >
                <X size={18} />
              </button>
              <Sidebar path={path} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface-solid text-ink shadow-card lg:hidden"
            >
              <Menu size={18} />
            </button>
            <QuickJump />
            <div className="ml-auto flex items-center gap-2.5">
              <span className="hidden rounded-full border border-line bg-surface-solid px-3 py-1.5 text-[12.5px] font-semibold text-mocha-deep md:inline">
                Explorer mode · real results
              </span>
              <ThemeToggle />
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Source code on GitHub"
                className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface-solid text-ink shadow-card hover:text-mocha"
              >
                <Github size={18} />
              </a>
            </div>
          </header>
          <main className="min-w-0 flex-1 px-4 pt-5 pb-8 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
