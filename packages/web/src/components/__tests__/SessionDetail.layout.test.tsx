import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDetail } from "../SessionDetail";
import { makeSession } from "../../__tests__/helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, options?: { loading?: () => JSX.Element }) => {
    const Loading = options?.loading;
    return Loading ?? (() => <div data-testid="direct-terminal">terminal</div>);
  },
}));

vi.mock("../ProjectSidebar", () => ({
  ProjectSidebar: () => <div data-testid="project-sidebar" />,
}));

vi.mock("../MobileBottomNav", () => ({
  MobileBottomNav: () => <nav aria-label="Session navigation" />,
}));

vi.mock("../SessionDetailHeader", () => ({
  SessionDetailHeader: ({ headline }: { headline: string }) => <div>{headline}</div>,
}));

vi.mock("../SessionEndedSummary", () => ({
  SessionEndedSummary: () => <div>Ended summary</div>,
}));

function mockDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("SessionDetail layout", () => {
  beforeEach(() => {
    mockDesktopViewport();
  });

  it("renders the session body inside a dedicated vertical scroll region", () => {
    render(<SessionDetail session={makeSession()} />);

    const scrollRegion = screen.getByTestId("session-detail-scroll-region");
    expect(scrollRegion).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    expect(scrollRegion.querySelector(".session-detail-terminal-placeholder")).not.toBeNull();
  });
});
