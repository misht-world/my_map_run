import { describe, it, expect } from "vitest";
import { interpretBarrier } from "../src/barrier.js";

describe("interpretBarrier", () => {
  it("gate with foot=no → blocked", () => {
    expect(interpretBarrier({ barrier: "gate", foot: "no" })?.status).toBe("blocked");
  });
  it("gate with access=private (no foot override) → blocked", () => {
    expect(interpretBarrier({ barrier: "gate", access: "private" })?.status).toBe("blocked");
  });
  it("stile with foot=private → blocked", () => {
    expect(interpretBarrier({ barrier: "stile", foot: "private" })?.status).toBe("blocked");
  });
  it("gate with foot=yes → passable", () => {
    expect(interpretBarrier({ barrier: "gate", foot: "yes" })?.status).toBe("passable");
  });
  it("kissing_gate with no access tags → passable", () => {
    expect(interpretBarrier({ barrier: "kissing_gate" })?.status).toBe("passable");
  });
  it("gate with access=private but foot=yes → passable (foot override)", () => {
    expect(interpretBarrier({ barrier: "gate", access: "private", foot: "yes" })?.status).toBe("passable");
  });
  it("standalone access=no node (no barrier) → blocked", () => {
    expect(interpretBarrier({ access: "no" })?.status).toBe("blocked");
  });
  it("plain node with no barrier/access → null", () => {
    expect(interpretBarrier({ amenity: "bench" })).toBeNull();
  });
  it("kerb (untracked barrier) with no ban → null", () => {
    expect(interpretBarrier({ barrier: "kerb" })).toBeNull();
  });
  it("door=yes with foot=no → null (building door, not an obstacle)", () => {
    expect(interpretBarrier({ door: "yes", foot: "no" })).toBeNull();
  });
  it("door=hinged → null", () => {
    expect(interpretBarrier({ door: "hinged" })).toBeNull();
  });
  it("barrier=gate with entrance=home → null", () => {
    expect(interpretBarrier({ barrier: "gate", entrance: "home", access: "private" })).toBeNull();
  });
  it("barrier=gate with entrance=yes → null", () => {
    expect(interpretBarrier({ barrier: "gate", entrance: "yes", foot: "no" })).toBeNull();
  });
});
