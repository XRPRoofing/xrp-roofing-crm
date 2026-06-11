"use client";

import { loadAllInvoices } from "./invoice-sync";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
  dueDate?: string;
  status?: string;
  lineItems?: Array<{ unitPrice?: number; quantity?: number; tax?: number }>;
  payments?: Array<{ amount?: number }>;
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  discount?: number;
  total?: number;
  balance?: number;
  notes?: string;
  paymentTerms?: string;
  warrantyNotes?: string;
  jobReference?: string;
  sentAt?: string;
  sentBy?: string;
  viewedAt?: string;
  paidAt?: string;
  activity?: string[];
  isDeleted?: boolean;
  deletedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Calculate customer balance from their invoices.
 * Returns the total outstanding balance across all non-deleted, non-voided invoices.
 */
export async function getCustomerBalance(customerName: string): Promise<number> {
  const invoices = await loadAllInvoices<Invoice>();
  const customerInvoices = invoices.filter(
    (inv) => 
      inv.clientName === customerName && 
      !inv.isDeleted && 
      inv.status !== "Voided"
  );
  
  return customerInvoices.reduce((sum, inv) => {
    const total = calculateInvoiceTotal(inv);
    const paid = getPaidAmount(inv);
    return sum + Math.max(total - paid, 0);
  }, 0);
}

/**
 * Calculate total amount for a single invoice
 */
function calculateInvoiceTotal(invoice: Invoice): number {
  const lineItems = invoice.lineItems || [];
  const subtotal = lineItems.reduce(
    (sum, item) => sum + (item.unitPrice || 0) * (item.quantity || 0),
    0
  );
  const taxRate = invoice.taxRate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = invoice.discount || 0;
  return subtotal + taxAmount - discount;
}

/**
 * Get total paid amount from invoice payments
 */
function getPaidAmount(invoice: Invoice): number {
  const payments = invoice.payments || [];
  return payments.reduce((sum, p) => sum + (p.amount || 0), 0);
}

/**
 * Calculate total lifetime value for a customer
 * Sum of all paid amounts across all invoices
 */
export async function getCustomerLifetimeValue(customerName: string): Promise<number> {
  const invoices = await loadAllInvoices<Invoice>();
  const customerInvoices = invoices.filter(
    (inv) => 
      inv.clientName === customerName && 
      !inv.isDeleted && 
      inv.status !== "Voided"
  );
  
  return customerInvoices.reduce((sum, inv) => {
    return sum + getPaidAmount(inv);
  }, 0);
}

/**
 * Get all financial metrics for a customer
 */
export async function getCustomerFinancialMetrics(customerName: string): Promise<{
  totalInvoiced: number;
  totalPaid: number;
  outstandingBalance: number;
  invoiceCount: number;
  paidInvoiceCount: number;
}> {
  const invoices = await loadAllInvoices<Invoice>();
  const customerInvoices = invoices.filter(
    (inv) => 
      inv.clientName === customerName && 
      !inv.isDeleted && 
      inv.status !== "Voided"
  );
  
  let totalInvoiced = 0;
  let totalPaid = 0;
  let paidInvoiceCount = 0;
  
  for (const inv of customerInvoices) {
    const total = calculateInvoiceTotal(inv);
    const paid = getPaidAmount(inv);
    
    totalInvoiced += total;
    totalPaid += paid;
    
    if (paid >= total && total > 0) {
      paidInvoiceCount++;
    }
  }
  
  return {
    totalInvoiced,
    totalPaid,
    outstandingBalance: Math.max(totalInvoiced - totalPaid, 0),
    invoiceCount: customerInvoices.length,
    paidInvoiceCount,
  };
}
