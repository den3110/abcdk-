import { render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mui/icons-material", () => {
  const StubIcon = () => null;

  return {
    ApiRounded: StubIcon,
    AutoAwesomeRounded: StubIcon,
    ArrowOutwardRounded: StubIcon,
    BoltRounded: StubIcon,
    CheckRounded: StubIcon,
    ContentCopyRounded: StubIcon,
    DarkModeRounded: StubIcon,
    EventRounded: StubIcon,
    GroupsRounded: StubIcon,
    LightModeRounded: StubIcon,
    LockRounded: StubIcon,
    KeyboardArrowDownRounded: StubIcon,
    PublicRounded: StubIcon,
    SearchRounded: StubIcon,
    SensorsRounded: StubIcon,
    SportsTennisRounded: StubIcon,
    StreamRounded: StubIcon,
  };
});

import ApiDocsPage from "./ApiDocsPage.jsx";
import { LanguageContextProvider } from "../context/LanguageContext.jsx";
import { ThemeContextProvider } from "../context/ThemeContext.jsx";

function renderApiDocs({
  language = "en",
  docsApiBaseUrl = "https://api.example.com",
} = {}) {
  window.localStorage.setItem("app-language", language);
  window.localStorage.setItem("app-language-source", "user");
  window.localStorage.setItem("theme-mode", "light");

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      docsApiBaseUrl,
    }),
  });

  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/docs/api"]}>
        <ThemeContextProvider>
          <LanguageContextProvider>
            <ApiDocsPage />
          </LanguageContextProvider>
        </ThemeContextProvider>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("ApiDocsPage", () => {
  it("renders the current-court endpoint details in English", async () => {
    renderApiDocs({ language: "en" });

    expect(
      await screen.findByRole("heading", { name: "Documentation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ask AI")).toBeInTheDocument();
    expect(screen.getByText("Get one live court")).toBeInTheDocument();
    expect(
      screen.getByText("Court exists but has no current match"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Run the public court snapshot endpoint"),
    ).toBeInTheDocument();
  });

  it("follows the app language and renders Vietnamese docs chrome", async () => {
    renderApiDocs({ language: "vi" });

    expect(
      await screen.findByRole("heading", { name: "Tài liệu API" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hỏi AI")).toBeInTheDocument();
    expect(
      screen.getByText("Lấy sân live và trận hiện tại"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Chạy thử endpoint sân hiện tại"),
    ).toBeInTheDocument();
  });

  it("uses the configured docs base URL from the public settings endpoint", async () => {
    renderApiDocs({ docsApiBaseUrl: "https://docs-api.pickletour.vn" });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/public/guide-link", {
        headers: {
          Accept: "application/json",
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getAllByText(/https:\/\/docs-api\.pickletour\.vn/).length,
      ).toBeGreaterThan(0);
    });
  });
});
