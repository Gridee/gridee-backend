import { describe, it, expect } from "vitest";
import {
  welcomeMessage,
  helpLandlord,
  helpTenant,
  errorGeneric,
  sessionExpired,
  otpMessage,
  registrationSuccess,
  invalidOTP,
  resendOTP,
  propertyRegistered,
  alreadyRegistered,
  rolePrompt,
} from "../../src/services/templateService";

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

// --- otpMessage -----------------------------------------------------

describe("otpMessage", () => {
  const msg = otpMessage("483920");

  it("contains the OTP code", () => {
    expect(msg).toContain("483920");
  });

  it("states the code is valid for 5 minutes", () => {
    expect(msg).toContain("5 minutes");
  });

  it("instructs the user not to share the code", () => {
    expect(msg.toLowerCase()).toContain("do not share");
  });

  it("works with any 6-digit code", () => {
    const msg2 = otpMessage("001122");
    expect(msg2).toContain("001122");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- registrationSuccess -----------------------------------------------------

describe("registrationSuccess", () => {
  describe("landlord variant", () => {
    const msg = registrationSuccess("Tunde Bello", "landlord");

    it("includes the user's name", () => {
      expect(msg).toContain("Tunde Bello");
    });

    it("confirms registration with a positive signal", () => {
      const lower = msg.toLowerCase();
      expect(lower.includes("registered") || lower.includes("ready")).toBe(
        true
      );
    });

    it("points landlord toward ADD PROPERTY as the next step", () => {
      expect(msg).toContain("ADD PROPERTY");
    });

    it("stays within WhatsApp's 4,096-character limit", () => {
      expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    });
  });

  describe("tenant variant", () => {
    const msg = registrationSuccess("Amaka Obi", "tenant");

    it("includes the user's name", () => {
      expect(msg).toContain("Amaka Obi");
    });

    it("confirms registration with a positive signal", () => {
      const lower = msg.toLowerCase();
      expect(lower.includes("registered") || lower.includes("ready")).toBe(
        true
      );
    });

    it("points tenant toward BUY as the next step", () => {
      expect(msg).toContain("BUY");
    });

    it("stays within WhatsApp's 4,096-character limit", () => {
      expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
    });
  });

  it("produces different output for landlord vs tenant with the same name", () => {
    const landlordMsg = registrationSuccess("Emeka", "landlord");
    const tenantMsg = registrationSuccess("Emeka", "tenant");
    expect(landlordMsg).not.toEqual(tenantMsg);
  });
});

// --- invalidOTP --------------------------------------------------------------

describe("invalidOTP", () => {
  const msg = invalidOTP();

  it("signals the OTP was incorrect", () => {
    const lower = msg.toLowerCase();
    expect(
      lower.includes("incorrect") ||
      lower.includes("doesn't match") ||
      lower.includes("wrong")
    ).toBe(true);
  });

  it("tells the user to try again", () => {
    expect(msg.toLowerCase()).toContain("try again");
  });

  it("mentions the RESEND option", () => {
    expect(msg).toContain("RESEND");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- resendOTP ---------------------------------------------------------------

describe("resendOTP", () => {
  const msg = resendOTP();

  it("confirms a new code has been sent", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("sent") || lower.includes("new")).toBe(true);
  });

  it("states the code is valid for 5 minutes", () => {
    expect(msg).toContain("5 minutes");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- propertyRegistered ------------------------------------------------------

describe("propertyRegistered", () => {
  const msg = propertyRegistered("GRD-LAG-0042", "Surulere Block A");

  it("contains the property code", () => {
    expect(msg).toContain("GRD-LAG-0042");
  });

  it("contains the property label", () => {
    expect(msg).toContain("Surulere Block A");
  });

  it("tells the landlord to share the code with tenants", () => {
    expect(msg.toLowerCase()).toContain("share");
  });

  it("works with a different code and label", () => {
    const msg2 = propertyRegistered("GRD-ABJ-0001", "Wuse Zone 4");
    expect(msg2).toContain("GRD-ABJ-0001");
    expect(msg2).toContain("Wuse Zone 4");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- alreadyRegistered -------------------------------------------------------

describe("alreadyRegistered", () => {
  const msg = alreadyRegistered();

  it("tells the user they already have an account", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("already") || lower.includes("account")).toBe(true);
  });

  it("points them to the HELP command", () => {
    expect(msg).toContain("HELP");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- rolePrompt --------------------------------------------------------------

describe("rolePrompt", () => {
  const msg = rolePrompt();

  it("presents a choice between landlord and tenant", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("landlord")).toBe(true);
    expect(lower.includes("tenant")).toBe(true);
  });

  it("prompts the user to reply with 1 or 2", () => {
    expect(msg).toContain("1");
    expect(msg).toContain("2");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});
