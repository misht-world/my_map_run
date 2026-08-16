import { describe, it, expect } from "vitest";
import { interpretFoot } from "../src/foot.js";

describe("interpretFoot — designated tier", () => {
  it("footway → designated", () => {
    expect(interpretFoot({ highway: "footway" }).tier).toBe("designated");
  });
  it("path → designated", () => {
    expect(interpretFoot({ highway: "path" }).tier).toBe("designated");
  });
  it("pedestrian → designated", () => {
    expect(interpretFoot({ highway: "pedestrian" }).tier).toBe("designated");
  });
  it("track → designated", () => {
    expect(interpretFoot({ highway: "track" }).tier).toBe("designated");
  });
  it("steps → designated, is_steps=true", () => {
    const r = interpretFoot({ highway: "steps" });
    expect(r.tier).toBe("designated");
    expect(r.is_steps).toBe(true);
  });
  it("busy road with mapped sidewalk → designated", () => {
    expect(interpretFoot({ highway: "secondary", sidewalk: "both" }).tier).toBe("designated");
  });
  it("foot=designated on any road → designated", () => {
    expect(interpretFoot({ highway: "primary", foot: "designated" }).tier).toBe("designated");
  });
  it("access=private but foot=yes → designated (foot override)", () => {
    expect(interpretFoot({ highway: "service", access: "private", foot: "yes" }).tier).toBe("designated");
  });
});

describe("interpretFoot — allowed tier", () => {
  it("residential without sidewalk → allowed", () => {
    expect(interpretFoot({ highway: "residential" }).tier).toBe("allowed");
  });
  it("living_street → allowed", () => {
    expect(interpretFoot({ highway: "living_street" }).tier).toBe("allowed");
  });
  it("tertiary without sidewalk → allowed", () => {
    expect(interpretFoot({ highway: "tertiary" }).tier).toBe("allowed");
  });
  it("cycleway without foot info → allowed", () => {
    expect(interpretFoot({ highway: "cycleway" }).tier).toBe("allowed");
  });
});

describe("interpretFoot — excluded (no line)", () => {
  it("motorway → null", () => {
    expect(interpretFoot({ highway: "motorway" }).tier).toBeNull();
  });
  it("trunk → null", () => {
    expect(interpretFoot({ highway: "trunk" }).tier).toBeNull();
  });
  it("foot=no overrides a footway → null", () => {
    expect(interpretFoot({ highway: "footway", foot: "no" }).tier).toBeNull();
  });
  it("foot=private → null", () => {
    expect(interpretFoot({ highway: "path", foot: "private" }).tier).toBeNull();
  });
  it("access=private without foot override → null", () => {
    expect(interpretFoot({ highway: "service", access: "private" }).tier).toBeNull();
  });
  it("secondary without sidewalk → null (busy road, avoid)", () => {
    expect(interpretFoot({ highway: "secondary" }).tier).toBeNull();
  });
  it("primary without sidewalk → null", () => {
    expect(interpretFoot({ highway: "primary" }).tier).toBeNull();
  });
  it("construction → null", () => {
    expect(interpretFoot({ highway: "construction" }).tier).toBeNull();
  });
  it("no highway tag → null", () => {
    expect(interpretFoot({ amenity: "cafe" }).tier).toBeNull();
  });
});
