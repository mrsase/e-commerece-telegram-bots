import { describe, expect, it } from "vitest";
import { courierDeliveryIdFromData } from "./courier-bot-interactive.js";

describe("courierDeliveryIdFromData", () => {
  it("parses a valid delivery id from the location callback", () => {
    expect(courierDeliveryIdFromData("courier:location:12", "courier:location:")).toBe(12);
    expect(courierDeliveryIdFromData("courier:contact:42", "courier:contact:")).toBe(42);
    expect(courierDeliveryIdFromData("courier:delivery:7", "courier:delivery:")).toBe(7);
  });

  it("returns null for a missing or empty id — never NaN or 0", () => {
    expect(courierDeliveryIdFromData("courier:location:", "courier:location:")).toBeNull();
    expect(courierDeliveryIdFromData("courier:location:abc", "courier:location:")).toBeNull();
    expect(courierDeliveryIdFromData("courier:location:12.5", "courier:location:")).toBeNull();
    expect(courierDeliveryIdFromData("courier:location:-5", "courier:location:")).toBeNull();
    expect(courierDeliveryIdFromData("courier:location:0", "courier:location:")).toBeNull();
    expect(courierDeliveryIdFromData("courier:location:", "courier:location:")).toBeNull();
  });

  it("rejects trailing garbage after a numeric id", () => {
    expect(courierDeliveryIdFromData("courier:location:12:extra", "courier:location:")).toBeNull();
    expect(courierDeliveryIdFromData("courier:location:12abc", "courier:location:")).toBeNull();
  });

  it("returns null when the payload does not match the expected prefix", () => {
    expect(courierDeliveryIdFromData("courier:status:fail:12", "courier:location:")).toBeNull();
    expect(courierDeliveryIdFromData("courier:menu", "courier:location:")).toBeNull();
  });
});