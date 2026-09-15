import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveStyleControl } from "@/theme/LiveStyleControl";

function Field({ property = "font-size", initial = "16px" }) {
  const [value, setValue] = useState(initial);
  return <><LiveStyleControl property={property} label="בדיקה" value={value} onChange={setValue} /><output data-testid="value">{value}</output></>;
}
describe("live style controls", () => {
  it("steps through buttons and keyboard and retains units", () => {
    render(<Field />);
    fireEvent.click(screen.getByLabelText("הגדל בדיקה"));
    expect(screen.getByTestId("value")).toHaveTextContent("17px");
    fireEvent.keyDown(screen.getByLabelText("בדיקה"), { key: "ArrowDown" });
    expect(screen.getByTestId("value")).toHaveTextContent("16px");
    fireEvent.change(screen.getByLabelText("יחידות בדיקה"), { target: { value: "rem" } });
    fireEvent.click(screen.getByLabelText("הקטן בדיקה"));
    expect(screen.getByTestId("value")).toHaveTextContent("15.9rem");
  });
  it("preserves complex CSS until an explicit numeric choice", () => {
    render(<Field property="padding" initial="4px 8px" />);
    expect(screen.getByLabelText("הגדל בדיקה")).toBeDisabled();
    expect(screen.getByTestId("value")).toHaveTextContent("4px 8px");
    fireEvent.change(screen.getByLabelText("ערך התחלתי בדיקה"), { target: { value: "8px" } });
    fireEvent.click(screen.getByLabelText("הגדל בדיקה"));
    expect(screen.getByTestId("value")).toHaveTextContent("9px");
  });
  it.each([["opacity", "1", "1"], ["padding", "0px", "0px"], ["margin", "0px", "-1px"]])("bounds %s appropriately", (property, initial, expected) => {
    render(<Field property={property} initial={initial} />);
    fireEvent.click(screen.getByLabelText(`${property === "opacity" ? "הגדל" : "הקטן"} בדיקה`));
    expect(screen.getByTestId("value")).toHaveTextContent(expected);
  });
  it.each([["font-family", "Arial, sans-serif"], ["font-weight", "700"], ["text-align", "center"]])("selects %s and retains manual entry", (property, expected) => {
    render(<Field property={property} initial="inherit" />);
    fireEvent.change(screen.getByLabelText("בחירת בדיקה"), { target: { value: expected } });
    expect(screen.getByTestId("value")).toHaveTextContent(expected);
    fireEvent.change(screen.getByLabelText("בדיקה"), { target: { value: "inherit" } });
    expect(screen.getByTestId("value")).toHaveTextContent("inherit");
  });
});
