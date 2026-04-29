/**
 * src/templates/index.ts
 *
 * Gridee WhatsApp / SMS message template module.
 *
 * Rules:
 *  - Every function is a pure function: no imports, no side effects, no I/O.
 *  - WhatsApp text formatting: *bold*, _italic_, line breaks via \n.
 *  - Tone: warm, friendly, Nigerian — not a banking robot.
 *  - Every message must stay under 4,096 characters (WhatsApp hard limit).
 *
 * Ownership : Mark David  (copy, tone, formatting)
 * Consumed by: notificationService.ts -> WhatsApp sender / SMS fallback
 */

// --- Day 1 Templates --------------------------------------------------------

/**
 * Sent immediately after a user completes registration.
 * Role-aware: landlords and tenants receive different first-step guidance.
 *
 * @param name - The user's full name as entered during registration.
 * @param role - The user's role on the platform.
 */
export function welcomeMessage(
  name: string,
  role: "landlord" | "tenant"
): string {
  if (role === "landlord") {
    return [
      `🌿 *Welcome to Gridee, ${name}!*`,
      ``,
      `You're all set as a *Landlord*. Your tenants can now enjoy clean, prepaid solar energy — and you earn a revenue share every time they top up. 🔋`,
      ``,
      `Here's how to get started:`,
      `👉 Type *ADD PROPERTY* to register your first compound and get a Property Code.`,
      `👉 Share that code with your tenants so they can register under your property.`,
      `👉 Type *HELP* anytime to see all your commands.`,
      ``,
      `_Welcome aboard. Let's power Nigeria together. ⚡_`,
    ].join("\n");
  }

  return [
    `🌿 *Welcome to Gridee, ${name}!*`,
    ``,
    `You're all set as a *Tenant*. No more generator wahala — buy solar tokens and power your flat on your own terms. ⚡`,
    ``,
    `Here's how to get started:`,
    `👉 Type *BUY 2000* to purchase ₦2,000 worth of energy tokens.`,
    `👉 Type *BALANCE* anytime to check how much power you have left.`,
    `👉 Type *HELP* to see everything you can do.`,
    ``,
    `_Enjoy the light! 🌟_`,
  ].join("\n");
}

/**
 * Full command reference for landlords.
 * Shown when a landlord sends the HELP command.
 */
export function helpLandlord(): string {
  return [
    `🌿 *Gridee — Landlord Commands*`,
    ``,
    `Here's everything you can do:`,
    ``,
    `🏠 *MY PROPERTIES* — View all your registered compounds`,
    `➕ *ADD PROPERTY* — Register a new compound and get a Property Code`,
    `🔍 *PROPERTY [CODE]* — Details for a specific property`,
    `   _e.g. PROPERTY GRD-LAG-0042_`,
    `👥 *TENANTS [CODE]* — List all tenants under a property`,
    `💰 *EARNINGS* — Your total revenue share across all properties`,
    `💰 *EARNINGS [CODE]* — Earnings for one specific property`,
    `🏦 *WITHDRAW* — Transfer your earnings to your bank account`,
    `❌ *REMOVE TENANT [PHONE]* — Disconnect a tenant (e.g. after they vacate)`,
    `📋 *HELP* — Show this message again`,
    ``,
    `_Questions? We're always here. 🤝_`,
  ].join("\n");
}

/**
 * Full command reference for tenants.
 * Shown when a tenant sends the HELP command.
 */
export function helpTenant(): string {
  return [
    `🌿 *Gridee — Tenant Commands*`,
    ``,
    `Here's everything you can do:`,
    ``,
    `⚡ *BUY [amount]* — Purchase energy tokens in Naira`,
    `   _e.g. BUY 2000 to spend ₦2,000_`,
    `🔋 *BALANCE* — Check your current token balance and hours remaining`,
    `📜 *HISTORY* — See your last 10 top-ups`,
    `🏠 *MY PROPERTY* — Details of the compound you're registered under`,
    `📋 *HELP* — Show this message again`,
    ``,
    `_Tip: Top up before your balance runs low to avoid interruptions. ⚡_`,
  ].join("\n");
}

/**
 * Generic fallback when an unexpected server-side error occurs.
 * Does NOT expose internal error details or stack traces to the user.
 */
export function errorGeneric(): string {
  return [
    `😕 *Something went wrong on our end.*`,
    ``,
    `Please try again in a moment. If the problem keeps happening, type *HELP* to see your options.`,
    ``,
    `_We're sorry for the inconvenience. 🙏_`,
  ].join("\n");
}

/**
 * Sent when a user's multi-step conversation session has timed out in Redis.
 * Reassures them that their account data is safe before prompting a restart.
 */
export function sessionExpired(): string {
  return [
    `⏰ *Your session has timed out.*`,
    ``,
    `No wahala — just send *Hi* or *START* to begin again. If you're already registered, all your data is safe. 😊`,
  ].join("\n");
}
