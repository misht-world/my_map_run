import { describe, it, expect } from "vitest";
import { interpretNoRun } from "../src/foot.js";

describe("interpretNoRun — blocked (red dashed)", () => {
  it("foot=no → blocked", () => {
    expect(interpretNoRun({ highway: "footway", foot: "no" }).blocked).toBe(true);
  });
  it("foot=private → blocked", () => {
    expect(interpretNoRun({ highway: "path", foot: "private" }).blocked).toBe(true);
  });
  it("foot=use_sidepath → blocked", () => {
    expect(interpretNoRun({ highway: "residential", foot: "use_sidepath" }).blocked).toBe(true);
  });
  it("access=private → blocked", () => {
    expect(interpretNoRun({ highway: "residential", access: "private" }).blocked).toBe(true);
  });
  it("access=no → blocked", () => {
    expect(interpretNoRun({ highway: "service", access: "no" }).blocked).toBe(true);
  });
  it("access=customers → blocked", () => {
    expect(interpretNoRun({ highway: "service", access: "customers" }).blocked).toBe(true);
  });
  it("motorway → blocked", () => {
    expect(interpretNoRun({ highway: "motorway" }).blocked).toBe(true);
  });
  it("trunk_link → blocked", () => {
    expect(interpretNoRun({ highway: "trunk_link" }).blocked).toBe(true);
  });
  it("highway=construction → blocked", () => {
    expect(interpretNoRun({ highway: "construction", construction: "footway" }).blocked).toBe(true);
  });
  it("construction footway with foot=designated → still blocked (not built yet)", () => {
    expect(interpretNoRun({ highway: "construction", construction: "footway", foot: "designated", tunnel: "yes" }).blocked).toBe(true);
  });
  it("highway=proposed → blocked", () => {
    expect(interpretNoRun({ highway: "proposed" }).blocked).toBe(true);
  });
});

describe("interpretNoRun — not blocked (not drawn; basemap shows it)", () => {
  it("plain footway → not blocked", () => {
    expect(interpretNoRun({ highway: "footway" }).blocked).toBe(false);
  });
  it("residential → not blocked", () => {
    expect(interpretNoRun({ highway: "residential" }).blocked).toBe(false);
  });
  it("foot=yes overrides access=private → not blocked", () => {
    expect(interpretNoRun({ highway: "service", access: "private", foot: "yes" }).blocked).toBe(false);
  });
  it("foot=designated overrides → not blocked", () => {
    expect(interpretNoRun({ highway: "path", foot: "designated" }).blocked).toBe(false);
  });
  it("no highway tag → not blocked", () => {
    expect(interpretNoRun({ amenity: "cafe" }).blocked).toBe(false);
  });
  it("service=driveway (excluded) even with access=private → not blocked", () => {
    expect(interpretNoRun({ highway: "service", service: "driveway", access: "private" }).blocked).toBe(false);
  });
  it("service=alley (excluded) → not blocked", () => {
    expect(interpretNoRun({ highway: "service", service: "alley", access: "private" }).blocked).toBe(false);
  });
});
