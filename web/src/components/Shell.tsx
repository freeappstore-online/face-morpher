import type { ReactNode } from "react";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <>
      <div className="hidden md:flex h-screen">
        <aside
          className="flex flex-col border-r h-full shrink-0"
          style={{ width: "17rem", borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="p-6 font-bold text-lg" style={{ fontFamily: "Fraunces, serif" }}>
            😂 Face Morpher
          </div>
          <nav className="flex-1 px-4">
            <div className="text-xs font-semibold uppercase tracking-widest mb-3 mt-2" style={{ color: "var(--muted)" }}>
              Effects
            </div>
            <ul className="flex flex-col gap-1 text-sm" style={{ color: "var(--ink)" }}>
              <li className="px-3 py-2 rounded-lg" style={{ background: "rgba(37,99,235,0.08)", color: "var(--accent)" }}>👀 Big Eyes</li>
              <li className="px-3 py-2 rounded-lg hover:bg-[var(--line)] cursor-default">🥞 Squish</li>
              <li className="px-3 py-2 rounded-lg hover:bg-[var(--line)] cursor-default">🦒 Stretch</li>
              <li className="px-3 py-2 rounded-lg hover:bg-[var(--line)] cursor-default">🌊 Wobble</li>
              <li className="px-3 py-2 rounded-lg hover:bg-[var(--line)] cursor-default">👾 Pixelate</li>
              <li className="px-3 py-2 rounded-lg hover:bg-[var(--line)] cursor-default">🌈 Rainbow</li>
              <li className="px-3 py-2 rounded-lg hover:bg-[var(--line)] cursor-default">👽 Alien</li>
              <li className="px-3 py-2 rounded-lg hover:bg-[var(--line)] cursor-default">🪞 Mirror</li>
            </ul>
          </nav>
          <div className="p-4 text-xs" style={{ color: "var(--muted)" }}>
            <a href="https://freeappstore.online" target="_blank" rel="noopener noreferrer"
              className="hover:underline" style={{ color: "var(--muted)" }}>
              Part of FreeAppStore — free forever
            </a>
          </div>
        </aside>
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
      <div className="flex flex-col h-screen md:hidden">
        <header className="flex items-center px-4 h-14 border-b shrink-0"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
          <span className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>😂 Face Morpher</span>
        </header>
        <main className="flex-1 overflow-auto p-4">{children}</main>
        <nav className="flex items-center justify-around h-16 border-t shrink-0"
          style={{ borderColor: "var(--line)", background: "var(--dock)" }}>
          <a href="https://freeappstore.online" target="_blank" rel="noopener noreferrer"
            className="text-xs text-center" style={{ color: "var(--muted)" }}>
            🏪<br />Store
          </a>
        </nav>
      </div>
    </>
  );
}
