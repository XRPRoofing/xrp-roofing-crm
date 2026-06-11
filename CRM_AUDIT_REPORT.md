# XRP Roofing CRM - Comprehensive Audit Report
**Date:** June 12, 2026  
**Scope:** Invoices, Payments, Jobs, Customers, Task Board, Reports, Synchronization

---

## EXECUTIVE SUMMARY

The CRM has **7 CRITICAL issues** causing data inconsistency across devices and inaccurate reporting. The root causes are:

1. **Soft deletes don't exist** - deleted records are removed from memory but may persist in totals calculations
2. **No "deleted" status tracking** - no way to exclude deleted records from reports
3. **localStorage fallback corrupts data** - when Supabase fails, stale local data becomes primary
4. **Missing SQL tables** - customers and invoices lack proper database tables
5. **Dashboard reads from localStorage** - not from Supabase
6. **No cascade updates** - customer balances don't recalculate when invoices change
7. **Race conditions** - multiple devices overwrite each other's data

---

## 1. INVOICES - CRITICAL ISSUES

### Issue 1.1: Deleted Invoices Still Affect Totals
**Severity:** CRITICAL  
**Location:** `app/crm/invoices/page.tsx:757-768`

```typescript
const boardTotals = useMemo(() => {
  const total = invoices.reduce((sum, invoice) => sum + calculateTotals(invoice).finalTotal, 0);
  // ... all calculations include EVERY invoice, no exclusion for deleted
}, [invoices]);
```

**Problem:** When `handleDeleteInvoice()` runs, it filters the invoice from the array, but:
- Dashboard metrics (on main CRM page) read from localStorage, not the current array
- Other devices may not receive the delete event
- The deleted invoice remains in `invoice_shares` table until explicitly removed

**Fix Required:**
- Add `isDeleted` flag to invoice schema (soft delete)
- Exclude `isDeleted: true` from ALL calculations
- Create cleanup job for permanently deleted records

### Issue 1.2: Invoice Calculations Use Wrong Tax Logic
**Severity:** HIGH  
**Location:** `app/crm/invoices/page.tsx:246-250`

```typescript
function calculateTotals(invoice: Pick<Invoice, "lineItems" | "discount">) {
  const tax = invoice.lineItems.reduce((total, item) => total + item.quantity * item.unitPrice * (item.tax / 100), 0);
```

**Problem:** Tax is calculated per-line-item, but there's also a `taxRate` field on the invoice. These can conflict.

**Fix Required:**
- Use invoice-level `taxRate` consistently
- Store calculated tax amount in database
- Recalculate on every invoice load to ensure accuracy

### Issue 1.3: No Invoice-to-Customer Balance Sync
**Severity:** CRITICAL  
**Location:** `app/crm/customers/page.tsx`

**Problem:** Customer balances are NOT calculated from invoice totals. The `lifetimeValue` field is manually entered, not derived from actual invoices.

**Fix Required:**
- Add `calculateCustomerBalance(customerId)` function
- Sum all non-deleted invoice balances for each customer
- Update customer record when invoice payments are recorded

---

## 2. PAYMENTS - CRITICAL ISSUES

### Issue 2.1: Offline Payments Don't Sync to Other Devices
**Severity:** CRITICAL  
**Location:** `app/crm/invoices/page.tsx:990-995`

```typescript
function handleMarkPaidOffline() {
  const payment: Payment = { amount: balance, date: today, method: "Cash", reference: "OFFLINE", notes: "Payment Received Offline", offline: true };
  updateInvoice({ ...selectedInvoice, payments: [...selectedInvoice.payments, payment] }, "Payment Received Offline");
}
```

**Problem:** Offline payments are marked with `offline: true` but:
- No mechanism to sync offline payments to Supabase when connection returns
- Other devices never see offline payments
- Mobile devices show different balances than desktop

**Fix Required:**
- Create `pending_payments` queue in localStorage
- On reconnection, flush queue to Supabase
- Add sync status indicator to payment records

### Issue 2.2: Partial Payment Balances Incorrect
**Severity:** HIGH  
**Location:** `app/crm/invoices/page.tsx:253-255`

```typescript
function getPaidAmount(invoice: Invoice) {
  return invoice.payments.reduce((total, payment) => total + payment.amount, 0);
}
```

**Problem:** No validation that payment amounts don't exceed invoice total. Multiple partial payments can result in overpayment without warning.

**Fix Required:**
- Add validation: `payment.amount <= remainingBalance`
- Show warning if overpayment detected
- Cap total payments at invoice total

---

## 3. JOBS - HIGH SEVERITY ISSUES

### Issue 3.1: Job Deletion Doesn't Cascade to Tasks
**Severity:** HIGH  
**Location:** `app/crm/leads/page.tsx:687, 743`

```typescript
function deleteJob(job: Lead) {
  // Only removes from localStorage jobs array
  // Task board still shows tasks for deleted jobs
}
```

**Problem:** When a job is deleted:
- Task board still shows tasks for that job
- Crew assignments remain in database
- Related photos/notes not cleaned up

**Fix Required:**
- Cascade delete: when job deleted → delete related tasks, crew assignments, photos
- Or add `isDeleted` flag and filter from views

### Issue 3.2: Active Jobs Count Includes Completed
**Severity:** MEDIUM  
**Location:** `app/crm/leads/page.tsx:297`

```typescript
{ label: "Active Jobs", value: jobs.filter((job) => ["scheduled", "in_progress", "final_inspection"].includes(job.stage)).length, tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
```

**Problem:** The logic is correct, but the job stage transitions may not properly move jobs from "completed" back to active if reopened.

**Fix Required:**
- Add validation preventing completed jobs from being edited without explicit reopen
- Add "Reopened" stage for tracking

---

## 4. CUSTOMERS - CRITICAL ISSUES

### Issue 4.1: Customer Balance Doesn't Include Invoices
**Severity:** CRITICAL  
**Location:** `types/crm.ts:27-37`

```typescript
export interface Customer {
  id: string;
  name: string;
  // ...
  lifetimeValue: number; // Manually entered, not calculated!
}
```

**Problem:** Customer has `lifetimeValue` field but:
- No link to customer's invoices
- No automatic calculation
- May show $50,000 lifetime value but have $75,000 in unpaid invoices

**Fix Required:**
- Add `customerId` field to invoices
- Create `getCustomerBalance(customerId)` function
- Calculate from sum of invoice balances
- Update in real-time when invoices change

### Issue 4.2: Customer Records Table Missing
**Severity:** CRITICAL  
**Location:** `supabase/customer-records.sql` (file may not exist)

**Problem:** The code references `customer_records` table but it may not be created in Supabase.

**Fix Required:**
- Verify `customer_records` table exists
- Run SQL migration if missing

---

## 5. TASK BOARD - MEDIUM SEVERITY

### Issue 5.1: Paid Tasks Created But Not Synced
**Severity:** MEDIUM  
**Location:** `lib/office-tasks.ts:194-201`

```typescript
// Auto-create Customer Satisfaction card when moved to Paid
const paidTask = updated.find((t) => t.id === taskId && t.status === "Paid");
const satId = paidTask ? `sat-${paidTask.jobId}` : "";
const withSat = paidTask && !updated.some((t) => t.id === satId)
  ? [{ ...paidTask, id: satId, status: "Customer Satisfaction" as OfficeTaskStatus, ... }]
  : updated;
```

**Problem:** Auto-creation works locally but:
- `saveOfficeTasks` syncs to Supabase via `saveAllTasksToSupabase`
- But there's no guarantee the sync succeeds
- Other devices may not see the new tasks

**Fix Required:**
- Verify `office_tasks` table exists
- Add retry logic for failed syncs
- Add sync status indicator on task board

---

## 6. DASHBOARD/REPORTS - CRITICAL ISSUES

### Issue 6.1: Dashboard Reads from localStorage (Not Supabase)
**Severity:** CRITICAL  
**Location:** `app/crm/page.tsx:24-27`

```typescript
function readJson<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(key) || "[]") as T[]; } catch { return []; }
}

const [invoices, setInvoices] = useState<InvoiceSnap[]>(() => readJson(invoicesKey));
```

**Problem:** The main CRM dashboard reads invoices from `localStorage`, not Supabase!
- Shows stale data
- Deleted invoices may reappear
- Doesn't reflect changes from other devices

**Fix Required:**
- Change dashboard to load from Supabase
- Use `loadAllInvoices()` instead of `readJson()`
- Add real-time subscription for updates

### Issue 6.2: No Exclusion of Deleted/Voided Records
**Severity:** HIGH  
**Location:** `app/crm/page.tsx:29-33`

```typescript
function invoicePaid(inv: InvoiceSnap): boolean {
  const total = (inv.lineItems || []).reduce((s, li) => s + li.unitPrice * li.quantity * (1 + (li.tax ?? 0) / 100), 0);
  const paid  = (inv.payments  || []).reduce((s, p) => s + p.amount, 0);
  return total > 0 && paid >= total;
}
```

**Problem:** This function doesn't check if invoice is `Voided` or deleted before calculating.

**Fix Required:**
- Add check: `if (inv.status === 'Voided' || inv.isDeleted) return false;`
- Exclude voided/deleted from all dashboard metrics

---

## 7. SYNCHRONIZATION - CRITICAL ISSUES

### Issue 7.1: Race Conditions on Simultaneous Edits
**Severity:** CRITICAL  
**Location:** `lib/invoice-sync.ts:142-165`

```typescript
export async function upsertInvoiceRecord(invoice: Record<string, unknown> & { id: string }): Promise<void> {
  const supabase = createClient();
  const row = invoiceToRow(invoice);
  const { error } = await supabase.from(invoicesTable).upsert(row, { onConflict: "id" });
  // ...
}
```

**Problem:** Two devices editing same invoice simultaneously:
- Both read version A
- Device 1 writes version B
- Device 2 writes version C (overwrites B)
- Changes from Device 1 are lost!

**Fix Required:**
- Add `updated_at` timestamp check
- Use `upsert` with `onConflict: "id"` AND `where: updated_at < new.updated_at`
- Implement optimistic locking

### Issue 7.2: Mobile Service Worker Caches API Calls
**Severity:** HIGH  
**Location:** `public/sw.js` (already fixed in recent commit)

**Problem:** The service worker was caching API responses, causing mobile to show stale data.

**Status:** Fixed in commit `569248b` - API calls now bypass cache

### Issue 7.3: localStorage Becomes Primary When Supabase Fails
**Severity:** CRITICAL  
**Location:** `lib/customer-sync.ts:47-56`, `lib/invoice-sync.ts:191-210`

```typescript
export async function loadCustomerRecordsResult(): Promise<CustomerLoadResult> {
  if (!hasSupabaseConfig()) return { customers: readLocal() };
  try {
    const response = await fetch("/api/customers", { cache: "no-store" });
    // ...
  } catch {
    return { customers: readLocal(), error: "Network error loading customers." };
  }
}
```

**Problem:** When Supabase fetch fails, code falls back to localStorage. The local data may be days old.

**Fix Required:**
- Show error message instead of silently falling back
- Add "Retry" button for failed loads
- Don't allow edits until fresh data is loaded

---

## FIX PRIORITY MATRIX

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | Dashboard reads from localStorage | 2 hrs | CRITICAL |
| P0 | Add soft delete (isDeleted flag) | 4 hrs | CRITICAL |
| P0 | Customer balance calculation | 3 hrs | CRITICAL |
| P1 | Offline payment sync queue | 4 hrs | HIGH |
| P1 | Invoice SQL table verification | 1 hr | HIGH |
| P1 | Customer SQL table verification | 1 hr | HIGH |
| P2 | Cascade delete jobs→tasks | 2 hrs | MEDIUM |
| P2 | Tax calculation consistency | 2 hrs | MEDIUM |
| P3 | Race condition prevention | 4 hrs | MEDIUM |

---

## IMMEDIATE ACTION PLAN

### Step 1: Database Setup (30 minutes)
1. Verify `invoices` table exists in Supabase
2. Verify `customer_records` table exists in Supabase
3. Verify `office_tasks` table exists in Supabase

### Step 2: Critical Fixes (4 hours)
1. Fix dashboard to load from Supabase
2. Add `isDeleted` flag to invoices
3. Calculate customer balances from invoices

### Step 3: Sync Fixes (4 hours)
1. Add offline payment queue
2. Fix race conditions with timestamp checks
3. Remove localStorage fallback on errors

### Step 4: Testing (2 hours)
1. Test delete invoice → verify removed from totals
2. Test mobile/desktop sync
3. Test offline payment sync

---

## CODE CHANGES REQUIRED

### Change 1: Dashboard Load from Supabase
**File:** `app/crm/page.tsx`

```typescript
// REPLACE:
const [invoices, setInvoices] = useState<InvoiceSnap[]>(() => readJson(invoicesKey));

// WITH:
import { loadAllInvoices } from "@/lib/invoice-sync";
const [invoices, setInvoices] = useState<InvoiceSnap[]>([]);
useEffect(() => {
  loadAllInvoices().then(data => setInvoices(data));
}, []);
```

### Change 2: Add isDeleted Flag
**File:** `types/crm.ts` (add to Invoice interface)

```typescript
export interface Invoice {
  // ... existing fields
  isDeleted?: boolean;
  deletedAt?: string;
}
```

### Change 3: Customer Balance Calculation
**New File:** `lib/customer-balance.ts`

```typescript
import { loadAllInvoices } from "./invoice-sync";

export async function getCustomerBalance(customerName: string): Promise<number> {
  const invoices = await loadAllInvoices();
  const customerInvoices = invoices.filter(
    inv => inv.clientName === customerName && !inv.isDeleted && inv.status !== 'Voided'
  );
  return customerInvoices.reduce((sum, inv) => {
    const total = calculateTotals(inv).finalTotal;
    const paid = getPaidAmount(inv);
    return sum + Math.max(total - paid, 0);
  }, 0);
}
```

---

## CONCLUSION

The CRM has fundamental data consistency issues that must be addressed immediately. The most critical are:

1. **Dashboard showing stale localStorage data** - Users see wrong numbers
2. **No soft delete** - Deleted records affect totals
3. **Customer balances not calculated** - Financial reports are wrong
4. **Offline payments not syncing** - Mobile/desktop show different data

These fixes will make the CRM reliable and consistent across all devices.
