/**
 * src/templates/templates.test.ts
 *
 * Unit tests for the Gridee message template module.
 *
 * Test strategy:
 *  - Assert that output CONTAINS expected substrings, not that it equals a
 *    fixed string. This lets the copy evolve freely without breaking the
 *    suite, as long as the key information is still present.
 *  - Every template is also checked against WhatsApp's 4,096-char hard limit.
 *
 * Run:  npm test
 * Watch: npm run test:watch
 */

import { describe, it, expect } from "vitest";
import {
  welcomeMessage,
  helpLandlord,
  helpTenant,
  errorGeneric,
  sessionExpired,
} from "./index";

const WHATSAPP_MAX_LENGTH = 4096;

// --- welcomeMessage ----------------------------------------------------------

describe("welcomeMessage", () => {
  describe("landlord variant", () => {
    const msg = welcomeMessage("Alhaji Musa", "landlord");

    it("includes the user's name", () => {
      expect(msg).toContain("Alhaji Musa");
    });

    it("identifies the role as Landlord", () => {
      expect(msg.toLowerCase()).toContain("landlord");
    });

    it("prompts the user to add a property", () => {
      expect(msg).toContain("ADD PROPERTY");
    });

    it("mentions the HELP command", () => {
      expect(msg).toContain("HELP");
    });

    it("stays within WhatsApp's 4,096-character limit", () => {
      expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    });
  });

  describe("tenant variant", () => {
    const msg = welcomeMessage("Chidinma", "tenant");

    it("includes the user's name", () => {
      expect(msg).toContain("Chidinma");
    });

    it("identifies the role as Tenant", () => {
      expect(msg.toLowerCase()).toContain("tenant");
    });

    it("promotes the BUY command as the first action", () => {
      expect(msg).toContain("BUY");
    });

    it("mentions the BALANCE command", () => {
      expect(msg).toContain("BALANCE");
    });

    it("mentions the HELP command", () => {
      expect(msg).toContain("HELP");
    });

    it("stays within WhatsApp's 4,096-character limit", () => {
      expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    });
  });

  it("produces different output for landlord vs tenant with the same name", () => {
    const landlordMsg = welcomeMessage("Tunde", "landlord");
    const tenantMsg = welcomeMessage("Tunde", "tenant");
    expect(landlordMsg).not.toEqual(tenantMsg);
  });

  it("correctly interpolates names that contain special characters", () => {
    const msg = welcomeMessage("Olu-Sola Adeyemi", "tenant");
    expect(msg).toContain("Olu-Sola Adeyemi");
  });
});

// --- helpLandlord ------------------------------------------------------------

describe("helpLandlord", () => {
  const msg = helpLandlord();

  it("lists the MY PROPERTIES command", () => {
    expect(msg).toContain("MY PROPERTIES");
  });

  it("lists the ADD PROPERTY command", () => {
    expect(msg).toContain("ADD PROPERTY");
  });

  it("lists the PROPERTY [CODE] command", () => {
    expect(msg).toContain("PROPERTY");
  });

  it("lists the TENANTS command", () => {
    expect(msg).toContain("TENANTS");
  });

  it("lists the EARNINGS command", () => {
    expect(msg).toContain("EARNINGS");
  });

  it("lists the WITHDRAW command", () => {
    expect(msg).toContain("WITHDRAW");
  });

  it("lists the REMOVE TENANT command", () => {
    expect(msg).toContain("REMOVE TENANT");
  });

  it("lists the HELP command", () => {
    expect(msg).toContain("HELP");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- helpTenant --------------------------------------------------------------

describe("helpTenant", () => {
  const msg = helpTenant();

  it("lists the BUY command", () => {
    expect(msg).toContain("BUY");
  });

  it("lists the BALANCE command", () => {
    expect(msg).toContain("BALANCE");
  });

  it("lists the HISTORY command", () => {
    expect(msg).toContain("HISTORY");
  });

  it("lists the MY PROPERTY command", () => {
    expect(msg).toContain("MY PROPERTY");
  });

  it("lists the HELP command", () => {
    expect(msg).toContain("HELP");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- errorGeneric ------------------------------------------------------------

describe("errorGeneric", () => {
  const msg = errorGeneric();

  it("does not expose raw error details (no 'Error:' prefix or 'stack')", () => {
    expect(msg).not.toContain("Error:");
    expect(msg).not.toContain("stack");
  });

  it("tells the user to try again", () => {
    expect(msg.toLowerCase()).toContain("try again");
  });

  it("points the user to the HELP command as a fallback", () => {
    expect(msg).toContain("HELP");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- sessionExpired ----------------------------------------------------------

describe("sessionExpired", () => {
  const msg = sessionExpired();

  it("communicates that the session has expired or timed out", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("expired") || lower.includes("timed out")).toBe(true);
  });

  it("tells the user to send START to restart", () => {
    expect(msg).toContain("START");
  });

  it("tells the user to send Hi to restart", () => {
    expect(msg).toContain("Hi");
  });

  it("reassures the user their data is safe", () => {
    expect(msg.toLowerCase()).toContain("safe");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});
