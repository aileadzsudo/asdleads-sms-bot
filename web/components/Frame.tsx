import type { ReactNode } from "react";

type FrameProps = {
  children: ReactNode;
};

export function Frame({ children }: FrameProps) {
  return <div className="app-frame">{children}</div>;
}
