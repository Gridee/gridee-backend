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
  otpMessage,
  registrationSuccess,
  invalidOTP,
  resendOTP,
  propertyRegistered,
  alreadyRegistered,
  rolePrompt,
  paymentInstructionsBankTransfer,
  paymentInstructionsMobileMoney,
  paymentInstructionsCrypto,
  paymentConfirmed,
  paymentExpired,
  paymentFailed,
  purchaseSMSConfirmation,
  lowBalanceAlert,
  cutoffNotice,
  restoredNotice,
  newTenantJoined,
  earningsSummary,
  withdrawalInitiated,
  withdrawalConfirmed,
  removedTenant,
  youHaveBeenRemoved,
} from "./index";

const WHATSAPP_MAX_LENGTH = 4096;
const SMS_MAX_LENGTH = 160;

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

// --- paymentInstructionsBankTransfer -----------------------------------------

describe("paymentInstructionsBankTransfer", () => {
  const msg = paymentInstructionsBankTransfer(
    "0123456789",
    "Wema Bank",
    "GRD-REF-00123",
    2000,
    15,
    420
  );

  it("contains the account number", () => {
    expect(msg).toContain("0123456789");
  });

  it("contains the bank name", () => {
    expect(msg).toContain("Wema Bank");
  });

  it("contains the payment reference", () => {
    expect(msg).toContain("GRD-REF-00123");
  });

  it("contains the NGN amount", () => {
    expect(msg).toContain("2,000");
  });

  it("contains the expiry window", () => {
    expect(msg).toContain("15");
  });

  it("contains the GRD amount the user will receive", () => {
    expect(msg).toContain("420");
  });

  it("warns the user to include the reference in their narration", () => {
    expect(msg.toLowerCase()).toContain("reference");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- paymentInstructionsMobileMoney ------------------------------------------

describe("paymentInstructionsMobileMoney", () => {
  const msg = paymentInstructionsMobileMoney("OPay", "GRD-REF-00456", 5000);

  it("contains the network name", () => {
    expect(msg).toContain("OPay");
  });

  it("contains the payment reference", () => {
    expect(msg).toContain("GRD-REF-00456");
  });

  it("contains the NGN amount", () => {
    expect(msg).toContain("5,000");
  });

  it("works with a different network", () => {
    const msg2 = paymentInstructionsMobileMoney(
      "PalmPay",
      "GRD-REF-00789",
      1000
    );
    expect(msg2).toContain("PalmPay");
    expect(msg2).toContain("GRD-REF-00789");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- paymentInstructionsCrypto -----------------------------------------------

describe("paymentInstructionsCrypto", () => {
  const wallet = "TXyz1234abcd5678WXYZ9012efgh3456IJKL";
  const msg = paymentInstructionsCrypto(wallet, 3.25, "GRD-REF-00999");

  it("contains the wallet address", () => {
    expect(msg).toContain(wallet);
  });

  it("contains the USDT amount", () => {
    expect(msg).toContain("3.25");
  });

  it("contains the payment reference", () => {
    expect(msg).toContain("GRD-REF-00999");
  });

  it("warns the user to send USDT only", () => {
    expect(msg.toUpperCase()).toContain("USDT");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- paymentConfirmed --------------------------------------------------------

describe("paymentConfirmed", () => {
  const msg = paymentConfirmed(420, 840, 12);

  it("shows the GRD amount credited in this transaction", () => {
    expect(msg).toContain("420");
  });

  it("shows the new total balance", () => {
    expect(msg).toContain("840");
  });

  it("shows the kWh equivalent", () => {
    expect(msg).toContain("12");
  });

  it("communicates success clearly", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("confirmed") || lower.includes("added")).toBe(true);
  });

  it("mentions the BALANCE command", () => {
    expect(msg).toContain("BALANCE");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- paymentExpired ----------------------------------------------------------

describe("paymentExpired", () => {
  const msg = paymentExpired();

  it("tells the user the payment window has expired", () => {
    expect(msg.toLowerCase()).toContain("expired");
  });

  it("reassures the user no money was deducted", () => {
    const lower = msg.toLowerCase();
    expect(
      lower.includes("no money") ||
        lower.includes("not been deducted") ||
        lower.includes("no payment")
    ).toBe(true);
  });

  it("tells the user to try again with BUY", () => {
    expect(msg).toContain("BUY");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- paymentFailed -----------------------------------------------------------

describe("paymentFailed", () => {
  const msg = paymentFailed("Insufficient funds");

  it("contains the reason passed in", () => {
    expect(msg).toContain("Insufficient funds");
  });

  it("reassures the user no money was deducted", () => {
    const lower = msg.toLowerCase();
    expect(
      lower.includes("no money") || lower.includes("not been deducted")
    ).toBe(true);
  });

  it("tells the user to try again with BUY", () => {
    expect(msg).toContain("BUY");
  });

  it("works with a different reason string", () => {
    const msg2 = paymentFailed("Transaction declined by bank");
    expect(msg2).toContain("Transaction declined by bank");
  });

  it("stays within WhatsApp's 4,096-character limit for a typical reason string", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- purchaseSMSConfirmation -------------------------------------------------

describe("purchaseSMSConfirmation", () => {
  const msg = purchaseSMSConfirmation(420, 840, "*384*0#");

  it("contains the GRD amount credited", () => {
    expect(msg).toContain("420");
  });

  it("contains the new balance", () => {
    expect(msg).toContain("840");
  });

  it("stays within the 160-character single SMS frame limit", () => {
    expect(msg.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it("contains no WhatsApp markdown (no asterisks or underscores for formatting)", () => {
    // Plain text only — formatting chars break SMS readability
    expect(msg).not.toMatch(/\*[a-zA-Z ]+\*/); // no *bold text* (digit-only sequences like USSD codes are fine)
    expect(msg).not.toMatch(/_[^_]+_/); // no _italic_
  });

  it("still fits within 160 chars with large GRD numbers", () => {
    const bigMsg = purchaseSMSConfirmation(99999, 199999, "*384*0#");
    expect(bigMsg.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });
});

// --- lowBalanceAlert ---------------------------------------------------------

describe("lowBalanceAlert", () => {
  const msg = lowBalanceAlert(0.8, 0.5);

  it("contains the GRD balance", () => {
    expect(msg).toContain("0.8");
  });

  it("contains the kWh estimate", () => {
    expect(msg).toContain("0.5");
  });

  it("prompts the user to top up with BUY", () => {
    expect(msg).toContain("BUY");
  });

  it("communicates urgency without being alarmist", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("low") || lower.includes("running low")).toBe(true);
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- cutoffNotice ------------------------------------------------------------

describe("cutoffNotice", () => {
  const msg = cutoffNotice();

  it("tells the user their access has been paused or suspended", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("paused") || lower.includes("suspended")).toBe(true);
  });

  it("tells them how to restore power with BUY", () => {
    expect(msg).toContain("BUY");
  });

  it("reassures the user power will be restored after payment", () => {
    expect(msg.toLowerCase()).toContain("restored");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });

  it("is a non-empty string", () => {
    expect(msg.trim().length).toBeGreaterThan(0);
  });
});

// --- restoredNotice ----------------------------------------------------------

describe("restoredNotice", () => {
  const msg = restoredNotice(420);

  it("contains the new GRD balance", () => {
    expect(msg).toContain("420");
  });

  it("communicates that power has been restored", () => {
    expect(msg.toLowerCase()).toContain("restored");
  });

  it("mentions the BALANCE command", () => {
    expect(msg).toContain("BALANCE");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- newTenantJoined ---------------------------------------------------------

describe("newTenantJoined", () => {
  const msg = newTenantJoined("Funke Adeyemi", "GRD-LAG-0042");

  it("contains the tenant's name", () => {
    expect(msg).toContain("Funke Adeyemi");
  });

  it("contains the property code", () => {
    expect(msg).toContain("GRD-LAG-0042");
  });

  it("communicates that a new tenant has joined", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("joined") || lower.includes("registered")).toBe(true);
  });

  it("works with different tenant names and property codes", () => {
    const msg2 = newTenantJoined("Emeka Okafor", "GRD-ABJ-0001");
    expect(msg2).toContain("Emeka Okafor");
    expect(msg2).toContain("GRD-ABJ-0001");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- earningsSummary ---------------------------------------------------------

describe("earningsSummary", () => {
  const breakdown = [
    { code: "GRD-LAG-0042", amount: 12500 },
    { code: "GRD-LAG-0099", amount: 7800 },
  ];
  const msg = earningsSummary(20300, breakdown);

  it("contains the total earnings", () => {
    expect(msg).toContain("20,300");
  });

  it("contains each property code in the breakdown", () => {
    expect(msg).toContain("GRD-LAG-0042");
    expect(msg).toContain("GRD-LAG-0099");
  });

  it("contains each property's earnings amount", () => {
    expect(msg).toContain("12,500");
    expect(msg).toContain("7,800");
  });

  it("mentions the WITHDRAW command", () => {
    expect(msg).toContain("WITHDRAW");
  });

  it("handles a single-property breakdown correctly", () => {
    const single = earningsSummary(5000, [
      { code: "GRD-PHC-0003", amount: 5000 },
    ]);
    expect(single).toContain("GRD-PHC-0003");
    expect(single).toContain("5,000");
  });

  it("handles an empty breakdown without crashing", () => {
    const empty = earningsSummary(0, []);
    expect(typeof empty).toBe("string");
    expect(empty.trim().length).toBeGreaterThan(0);
  });

  it("stays within WhatsApp's 4,096-character limit for a typical breakdown (10 properties)", () => {
    const manyProps = Array.from({ length: 10 }, (_, i) => ({
      code: `GRD-LAG-00${String(i).padStart(2, "0")}`,
      amount: 10000 + i * 1000,
    }));
    const bigMsg = earningsSummary(150000, manyProps);
    expect(bigMsg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- withdrawalInitiated -----------------------------------------------------

describe("withdrawalInitiated", () => {
  const msg = withdrawalInitiated(12500, "4521");

  it("contains the withdrawal amount", () => {
    expect(msg).toContain("12,500");
  });

  it("contains the last 4 digits of the bank account", () => {
    expect(msg).toContain("4521");
  });

  it("communicates the transfer is in progress", () => {
    const lower = msg.toLowerCase();
    expect(
      lower.includes("transfer") ||
        lower.includes("initiated") ||
        lower.includes("being")
    ).toBe(true);
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- withdrawalConfirmed -----------------------------------------------------

describe("withdrawalConfirmed", () => {
  const msg = withdrawalConfirmed(12500);

  it("contains the confirmed withdrawal amount", () => {
    expect(msg).toContain("12,500");
  });

  it("communicates success clearly", () => {
    const lower = msg.toLowerCase();
    expect(
      lower.includes("sent") ||
        lower.includes("complete") ||
        lower.includes("confirmed")
    ).toBe(true);
  });

  it("mentions the EARNINGS command as a next step", () => {
    expect(msg).toContain("EARNINGS");
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- removedTenant -----------------------------------------------------------

describe("removedTenant", () => {
  const msg = removedTenant("Amaka Obi");

  it("contains the removed tenant's name", () => {
    expect(msg).toContain("Amaka Obi");
  });

  it("confirms the tenant has been removed", () => {
    expect(msg.toLowerCase()).toContain("removed");
  });

  it("confirms the tenant's solar access has been stopped", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("stopped") || lower.includes("access")).toBe(true);
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});

// --- youHaveBeenRemoved ------------------------------------------------------

describe("youHaveBeenRemoved", () => {
  const msg = youHaveBeenRemoved("Surulere Block A");

  it("contains the property name", () => {
    expect(msg).toContain("Surulere Block A");
  });

  it("communicates the tenant has been removed", () => {
    expect(msg.toLowerCase()).toContain("removed");
  });

  it("tells them their solar access has been stopped", () => {
    const lower = msg.toLowerCase();
    expect(lower.includes("stopped") || lower.includes("access")).toBe(true);
  });

  it("does not expose the landlord's reason for removal", () => {
    // Should not contain any assumption about why they were removed
    expect(msg.toLowerCase()).not.toContain("reason");
    expect(msg.toLowerCase()).not.toContain("because");
  });

  it("is distinct from the landlord-facing removedTenant message", () => {
    const landlordMsg = removedTenant("Amaka Obi");
    expect(msg).not.toEqual(landlordMsg);
  });

  it("stays within WhatsApp's 4,096-character limit", () => {
    expect(msg.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});
