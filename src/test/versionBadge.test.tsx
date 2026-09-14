import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { VersionBadge } from "@/components/VersionBadge";
import { MemoryRouter } from 'react-router-dom';
it("anchors the single build label at the bottom left without blocking clicks", () => {
  render(<MemoryRouter><VersionBadge /></MemoryRouter>);
  const badge = screen.getByTestId("app-version");
  expect(badge).toHaveClass("app-version-badge");
  expect(badge).toHaveClass("pointer-events-none");
  expect(badge).not.toHaveClass("top-0", "left-1/2");
});
it('does not display the build label on inner sections', () => {
  const {container}=render(<MemoryRouter initialEntries={['/?section=daf']}><VersionBadge /></MemoryRouter>);
  expect(container.querySelector('[data-testid="app-version"]')).toBeNull();
});
