"use client";

import { FormEvent, useMemo, useState } from "react";
import { API_BASE_URL, apiRequest } from "@/lib/api";

type Role = "tenant" | "landlord";

export default function Home() {
  const [role, setRole] = useState<Role>("tenant");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [propertyCode, setPropertyCode] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [token, setToken] = useState("");
  const [log, setLog] = useState("Ready.");

  const [amount, setAmount] = useState(2000);
  const [method, setMethod] = useState("bank_transfer");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [stateName, setStateName] = useState("Lagos");
  const [flatCount, setFlatCount] = useState(4);
  const [tenantPhoneToRemove, setTenantPhoneToRemove] = useState("");

  const authHeader = useMemo(() => token.trim(), [token]);

  function pretty(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    const path = role === "landlord" ? "/api/auth/landlord/register" : "/api/auth/tenant/register";
    const body =
      role === "landlord"
        ? { name, phone }
        : { name, phone, propertyCode };
    const data = await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
    setLog(pretty(data));
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    const data = await apiRequest<{ token?: string; user?: unknown }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code: otpCode }),
    });
    if (data.token) setToken(data.token);
    setLog(pretty(data));
  }

  async function getTenantBalance() {
    const data = await apiRequest("/api/tenants/balance", {}, authHeader);
    setLog(pretty(data));
  }

  async function getTenantHistory() {
    const data = await apiRequest("/api/tenants/history", {}, authHeader);
    setLog(pretty(data));
  }

  async function getTenantProperty() {
    const data = await apiRequest(`/api/tenants/property?phone=${encodeURIComponent(phone)}`);
    setLog(pretty(data));
  }

  async function initiatePayment() {
    const data = await apiRequest("/api/payments/initiate", {
      method: "POST",
      body: JSON.stringify({ amountNGN: Number(amount), method, phone }),
    });
    setLog(pretty(data));
  }

  async function createProperty() {
    const data = await apiRequest("/api/properties", {
      method: "POST",
      body: JSON.stringify({
        address,
        label,
        flatCount: Number(flatCount),
        state: stateName,
      }),
    }, authHeader);
    setLog(pretty(data));
  }

  async function getLandlordProperties() {
    const data = await apiRequest(`/api/landlord/properties?phone=${encodeURIComponent(phone)}`);
    setLog(pretty(data));
  }

  async function getLandlordEarnings() {
    const data = await apiRequest(`/api/landlord/earnings?phone=${encodeURIComponent(phone)}`);
    setLog(pretty(data));
  }

  async function removeTenant() {
    const code = propertyCode.trim();
    const data = await apiRequest(`/api/landlord/properties/${code}/remove-tenant`, {
      method: "POST",
      body: JSON.stringify({ phone, tenantPhone: tenantPhoneToRemove }),
    });
    setLog(pretty(data));
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold">Gridee Web Console</h1>
        <p className="mt-1 text-sm text-slate-300">
          Responsive UI for tenant and landlord flows without WhatsApp/USSD.
        </p>
        <p className="mt-1 text-xs text-slate-400">API Base: {API_BASE_URL}</p>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="mb-3 font-medium">Session</h2>
            <div className="space-y-2">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <input value={propertyCode} onChange={(e) => setPropertyCode(e.target.value)} placeholder="Property Code (tenant/remove)" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="OTP code" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm">
                <option value="tenant">Tenant</option>
                <option value="landlord">Landlord</option>
              </select>
              <div className="flex gap-2">
                <button onClick={(e) => void register(e as unknown as FormEvent)} className="rounded bg-emerald-600 px-3 py-2 text-sm">Register</button>
                <button onClick={(e) => void verifyOtp(e as unknown as FormEvent)} className="rounded bg-indigo-600 px-3 py-2 text-sm">Verify OTP</button>
              </div>
              <textarea value={token} onChange={(e) => setToken(e.target.value)} placeholder="JWT token" rows={3} className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-xs" />
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="mb-3 font-medium">Tenant Actions</h2>
            <div className="space-y-2">
              <button onClick={() => void getTenantBalance()} className="w-full rounded bg-slate-700 px-3 py-2 text-sm">Get Balance</button>
              <button onClick={() => void getTenantHistory()} className="w-full rounded bg-slate-700 px-3 py-2 text-sm">Get History</button>
              <button onClick={() => void getTenantProperty()} className="w-full rounded bg-slate-700 px-3 py-2 text-sm">Get Property</button>
              <div className="pt-2">
                <label className="text-xs text-slate-400">Top-up Amount (NGN)</label>
                <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-2 w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm">
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mobile_money">Mobile money</option>
                </select>
                <button onClick={() => void initiatePayment()} className="mt-2 w-full rounded bg-blue-600 px-3 py-2 text-sm">Initiate Payment</button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="mb-3 font-medium">Landlord Actions</h2>
            <div className="space-y-2">
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Property label" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Property address" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <input value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="State" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <input type="number" value={flatCount} onChange={(e) => setFlatCount(Number(e.target.value))} placeholder="Flat count" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <button onClick={() => void createProperty()} className="w-full rounded bg-amber-600 px-3 py-2 text-sm">Create Property</button>
              <button onClick={() => void getLandlordProperties()} className="w-full rounded bg-slate-700 px-3 py-2 text-sm">List Properties</button>
              <button onClick={() => void getLandlordEarnings()} className="w-full rounded bg-slate-700 px-3 py-2 text-sm">Get Earnings</button>
              <input value={tenantPhoneToRemove} onChange={(e) => setTenantPhoneToRemove(e.target.value)} placeholder="Tenant phone to remove" className="w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm" />
              <button onClick={() => void removeTenant()} className="w-full rounded bg-rose-600 px-3 py-2 text-sm">Remove Tenant</button>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 font-medium">Response Log</h2>
          <pre className="overflow-x-auto rounded-xl border border-slate-700 bg-black p-4 text-xs text-emerald-300">
            {log}
          </pre>
        </section>
      </div>
    </main>
  );
}
