import "@testing-library/jest-dom";
import { vi } from 'vitest';

// jsdom has no layout/scroll implementation; browser QA verifies real scrolling.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true, writable: true, value: vi.fn(),
});

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
    dispatchEvent: () => {},
  }),
});
