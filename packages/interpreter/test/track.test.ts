import { describe, it, expect } from "vitest";
import { interpretTrack } from "../src/track.js";

describe("interpretTrack", () => {
  it("bare leisure=track → true", () => {
    expect(interpretTrack({ leisure: "track" })).toBe(true);
  });
  it("leisure=track sport=running → true", () => {
    expect(interpretTrack({ leisure: "track", sport: "running" })).toBe(true);
  });
  it("leisure=track sport=athletics → true", () => {
    expect(interpretTrack({ leisure: "track", sport: "athletics" })).toBe(true);
  });
  it("leisure=track sport=multi;running → true", () => {
    expect(interpretTrack({ leisure: "track", sport: "multi;running" })).toBe(true);
  });
  it("leisure=track sport=motor → false", () => {
    expect(interpretTrack({ leisure: "track", sport: "motor" })).toBe(false);
  });
  it("leisure=track sport=cycling → false", () => {
    expect(interpretTrack({ leisure: "track", sport: "cycling" })).toBe(false);
  });
  it("leisure=track sport=horse_racing → false", () => {
    expect(interpretTrack({ leisure: "track", sport: "horse_racing" })).toBe(false);
  });
  it("non-track → false", () => {
    expect(interpretTrack({ highway: "footway" })).toBe(false);
  });
});
