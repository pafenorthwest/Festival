import { describe, expect, it } from "bun:test";
import { buildSelection } from "../src/lib/cart.js";

describe("frontend cart helpers", () => {
  it("builds selection payload", () => {
    const selection = buildSelection(["solo-piano", "concert-showcase"], {
      "solo-piano": 1,
      "concert-showcase": 1
    });

    expect(selection.classIds.length).toBe(2);
    expect(selection.participantsByClass["solo-piano"]).toBe(1);
  });
});
