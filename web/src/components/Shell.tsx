import type { ReactNode } from "react";

// Shell is a transparent passthrough for Face Morpher —
// the app manages its own full-screen layout.
interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return <>{children}</>;
}
