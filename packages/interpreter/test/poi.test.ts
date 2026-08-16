import { describe, it, expect } from "vitest";
import { interpretPoi } from "../src/poi.js";

describe("interpretPoi", () => {
  it("amenity=drinking_water → water", () => {
    expect(interpretPoi({ amenity: "drinking_water" })).toBe("water");
  });
  it("man_made=water_tap (not marked undrinkable) → water", () => {
    expect(interpretPoi({ man_made: "water_tap" })).toBe("water");
  });
  it("natural=spring + drinking_water=yes → water", () => {
    expect(interpretPoi({ natural: "spring", drinking_water: "yes" })).toBe("water");
  });
  it("natural=spring without drinking_water → null", () => {
    expect(interpretPoi({ natural: "spring" })).toBeNull();
  });
  it("amenity=shelter → shelter", () => {
    expect(interpretPoi({ amenity: "shelter" })).toBe("shelter");
  });
  it("tourism=picnic_site → shelter", () => {
    expect(interpretPoi({ tourism: "picnic_site" })).toBe("shelter");
  });
  it("tourism=viewpoint → viewpoint", () => {
    expect(interpretPoi({ tourism: "viewpoint" })).toBe("viewpoint");
  });
  it("amenity=toilets → toilets", () => {
    expect(interpretPoi({ amenity: "toilets" })).toBe("toilets");
  });
  it("unrelated node → null", () => {
    expect(interpretPoi({ amenity: "cafe" })).toBeNull();
  });
  it("water wins over shelter when both present", () => {
    expect(interpretPoi({ amenity: "drinking_water", shelter_type: "public_transport" })).toBe("water");
  });
});
