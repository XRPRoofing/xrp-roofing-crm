/**
 * Server-side PDF manipulation for the PDF Signer.
 *
 * Uses pdf-lib to load an original PDF, draw filled field values (text and
 * embedded PNG signatures/initials), and produce a flattened final PDF as a
 * Uint8Array. This module must only run on the server (Next.js route handlers).
 */

import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from "pdf-lib";
import type { PdfField } from "@/lib/pdf-signer-types";

const FIELD_FONT_SIZE = 12;
const CHECK_SIZE = 10;

export async function getPdfPageSize(originalBytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const pdfDoc = await PDFDocument.load(originalBytes);
    const page = pdfDoc.getPage(0);
    return page.getSize();
  } catch {
    return null;
  }
}

export async function flattenSignedPdf(
  originalBytes: Uint8Array,
  fields: PdfField[],
  imageBytesMap: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Group fields by page index; clamp to available pages
  const pageFields = new Map<number, PdfField[]>();
  for (const field of fields) {
    const pageIndex = Math.max(0, Math.min(field.page, pages.length - 1));
    const list = pageFields.get(pageIndex) ?? [];
    list.push(field);
    pageFields.set(pageIndex, list);
  }

  for (const [pageIndex, fieldsOnPage] of pageFields.entries()) {
    const page = pages[pageIndex];
    if (!page) continue;
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Draw in sorted order so overlapping later fields appear on top
    const ordered = [...fieldsOnPage].sort((a, b) => (b.y ?? 0) - (a.y ?? 0));
    for (const field of ordered) {
      const x = Number(field.x) || 0;
      const y = Number(field.y) || 0;
      const w = Number(field.width) || 150;
      const h = Number(field.height) || 40;

      if (field.type === "label") {
        drawText(page, field.label || "", x, y, w, h, helveticaBold, FIELD_FONT_SIZE);
        continue;
      }

      if (field.type === "checkbox") {
        if (field.value && field.value.toLowerCase() === "true") {
          drawText(page, "X", x, y, w, h, helveticaBold, Math.min(h, FIELD_FONT_SIZE));
        }
        continue;
      }

      if (field.type === "radio" || field.type === "dropdown") {
        if (field.value) {
          drawText(page, field.value, x, y, w, h, helvetica, FIELD_FONT_SIZE);
        }
        continue;
      }

      if (field.type === "signature" || field.type === "initials") {
        if (field.value && imageBytesMap[field.value]) {
          const png = await pdfDoc.embedPng(imageBytesMap[field.value]);
          const aspect = png.width / png.height;
          let drawW = w;
          let drawH = h;
          if (drawW / drawH > aspect) {
            drawW = drawH * aspect;
          } else {
            drawH = drawW / aspect;
          }
          // Keep image within page bounds, growing upward from bottom-left anchor
          let drawX = Math.max(0, Math.min(x, pageWidth - drawW));
          let drawY = Math.max(0, Math.min(y, pageHeight - drawH));
          page.drawImage(png, { x: drawX, y: drawY, width: drawW, height: drawH });
        }
        continue;
      }

      // text, date, full_name, phone, email, address, and fallbacks
      if (field.value) {
        drawText(page, field.value, x, y, w, h, helvetica, FIELD_FONT_SIZE);
      }
    }
  }

  return await pdfDoc.save({ useObjectStreams: true });
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  font: PDFFont,
  size: number,
) {
  const { height: pageHeight } = page.getSize();
  // Anchor text near the top-left of the field box by placing the baseline
  // one font size below the top edge. The y supplied by the field editor is the
  // bottom-left corner in PDF points.
  const baseline = Math.min(y + height - size, pageHeight - size);
  page.drawText(String(text), {
    x,
    y: Math.max(size, baseline),
    size,
    font,
    color: rgb(0, 0, 0),
    maxWidth: Math.max(width, 1),
  });
}
