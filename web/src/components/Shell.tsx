"use client";

import {
  BarChart3,
  BookOpen,
  Columns3,
  FileSearch,
  Github,
  Inbox,
  Menu,
  Network,
  CircleCheck,
  ReceiptText,
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
    <Link href="/" className="flex items-center gap-3 px-2">
      <span className="grid h-10 w-10 place-items-center rounded-full text-[17px] font-bold text-white ring-1 ring-white/35">Σ</span>
      <span className="leading-tight">
        <span className="block text-[18px] font-semibold text-white">SumProof</span>
        <span className="block text-[12.5px] text-nav-muted">Receipt AI · filing search</span>
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
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] transition-colors ${
                active ? "bg-white/10 font-semibold text-white ring-1 ring-white/15" : "text-nav-ink hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={18} strokeWidth={1.8} className={active ? "text-white" : "text-nav-muted"} />
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
    <div className="flex h-full flex-col gap-6 px-4 py-6">
      <Logo />
      <nav aria-label="Main" className="flex flex-col gap-2 border-t border-white/10 pt-5">
        <NavList items={MAIN} path={path} onNavigate={onNavigate} />
      </nav>
      <nav aria-label="Workspace" className="flex flex-col gap-2 border-t border-white/10 pt-5">
        <NavList items={WORKSPACE} path={path} onNavigate={onNavigate} />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] text-nav-ink hover:bg-white/5 hover:text-white"
        >
          <Github size={18} strokeWidth={1.8} className="text-nav-muted" />
          Source code
        </a>
      </nav>
      <div className="mt-auto rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
        <p className="text-[13.5px] font-semibold text-white">Explorer mode</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-nav-muted">
          Real outputs from the evaluation runs. Live mode runs the models on a local GPU.
        </p>
        <p className="mt-2.5 text-[12.5px] font-semibold text-white">$0 · open models</p>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[248px] shrink-0 bg-nav lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar path={path} />
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="relative h-full w-[272px] bg-nav">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute top-6 right-3 grid h-9 w-9 place-items-center rounded-full text-nav-muted hover:text-white"
            >
              <X size={18} />
            </button>
            <Sidebar path={path} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-4 pt-5 sm:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-solid text-ink lg:hidden"
          >
            <Menu size={18} />
          </button>
          <QuickJump />
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden items-center gap-1.5 text-[13.5px] text-ink md:flex">
              <CircleCheck size={17} className="text-good" />
              Real evaluation results
            </span>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Source code on GitHub"
              className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface-solid text-ink hover:border-accent hover:text-accent"
            >
              <Github size={18} />
            </a>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pt-6 pb-10 sm:px-8">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
