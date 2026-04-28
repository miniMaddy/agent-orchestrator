import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDetail } from "../SessionDetail";
import { makeSession, makePR } from "../../__tests__/helpers";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../DirectTerminal", () => ({
  DirectTerminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="direct-terminal">{sessionId}</div>
  ),
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

  it("renders the session content inside a dedicated vertical scroll region", () => {
    render(
      <SessionDetail
        session={makeSession({
          pr: makePR({
            unresolvedThreads: 1,
            unresolvedComments: [
              {
                url: "https://github.com/acme/app/pull/100#discussion_r1",
                path: "src/index.ts",
                author: "bugbot",
                body: "### Follow-up\n<!-- DESCRIPTION START -->Keep this reachable below the terminal<!-- DESCRIPTION END -->",
              },
            ],
          }),
        })}
        projectOrchestratorId="my-app-orchestrator"
      />,
    );

    expect(screen.getByTestId("session-detail-scroll-region")).toHaveClass(
      "flex-1",
      "min-h-0",
      "overflow-y-auto",
    );
    expect(screen.getByText("Unresolved Comments")).toBeInTheDocument();
  });
});
