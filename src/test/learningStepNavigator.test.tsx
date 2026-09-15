import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LearningStepNavigator } from "@/components/study/LearningStepNavigator";

describe("learning step navigation", () => {
  for (const depth of [2, 3, 4]) it(`requires explicit selection through ${depth} levels and supports backtracking`, () => {
    const callbacks = Array.from({ length: depth }, () => vi.fn());
    function Harness() {
      const [confirmed, setConfirmed] = useState(false);
      return <><LearningStepNavigator confirmed={confirmed} onConfirmedChange={setConfirmed} steps={callbacks.map((onSelect, i) => ({
        title: `שלב ${i}`, backLabel: `שלב ${i}`, onSelect,
        options: [{ value: "a", label: `אפשרות ${i}` }, { value: "b", label: `חלופה ${i}` }],
      }))} /><div data-testid="ready">{String(confirmed)}</div></>;
    }
    render(<Harness />);
    for (let i = 0; i < depth; i++) {
      expect(screen.getByTestId("ready")).toHaveTextContent("false");
      expect(screen.getByRole("button", { name: `אפשרות ${i}` })).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(screen.getByRole("button", { name: `אפשרות ${i}` }));
      expect(callbacks[i]).toHaveBeenCalledWith("a");
    }
    expect(screen.getByTestId("ready")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: `חזרה לשלב ${depth - 2}` }));
    expect(screen.getByTestId("ready")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: `חלופה ${depth - 2}` }));
    expect(screen.getByRole("button", { name: `אפשרות ${depth - 1}` })).toHaveAttribute("aria-pressed", "false");
  });
});
