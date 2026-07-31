import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskDial } from "./RiskDial.js";

describe("RiskDial", () => {
  it("renders the risk as a rounded percentage", () => {
    render(<RiskDial risk={0.42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("clamps risk above 1 down to 100", () => {
    render(<RiskDial risk={1.5} />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("clamps negative risk up to 0", () => {
    render(<RiskDial risk={-0.3} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("uses the muted success color at low risk", () => {
    render(<RiskDial risk={0.1} />);
    expect(screen.getByText("10")).toHaveStyle({ color: "#5c7a48" });
  });

  it("uses the muted warning color at medium risk", () => {
    render(<RiskDial risk={0.4} />);
    expect(screen.getByText("40")).toHaveStyle({ color: "#b07f2c" });
  });

  it("uses the muted danger color at high risk", () => {
    render(<RiskDial risk={0.9} />);
    expect(screen.getByText("90")).toHaveStyle({ color: "#a8453a" });
  });
});
