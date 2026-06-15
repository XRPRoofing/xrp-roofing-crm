"use client";

import React from "react";

function toTelHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

const linkStyle: React.CSSProperties = { color: "inherit", textDecoration: "inherit" };

export function PhoneLink({
  value,
  fallback,
  className,
}: {
  value?: string;
  fallback?: string;
  className?: string;
}) {
  const display = value || fallback || "";
  if (!value) return <>{display}</>;

  const href = toTelHref(value);
  if (!href) return <>{display}</>;

  return (
    <a
      href={href}
      className={className}
      style={linkStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {display}
    </a>
  );
}

export function EmailLink({
  value,
  fallback,
  className,
}: {
  value?: string;
  fallback?: string;
  className?: string;
}) {
  const display = value || fallback || "";
  if (!value) return <>{display}</>;

  return (
    <a
      href={`mailto:${value}`}
      className={className}
      style={linkStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {display}
    </a>
  );
}

function toMapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function AddressLink({
  value,
  fallback,
  className,
}: {
  value?: string;
  fallback?: string;
  className?: string;
}) {
  const display = value || fallback || "";
  if (!value) return <>{display}</>;

  return (
    <a
      href={toMapsHref(value)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={linkStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {display}
    </a>
  );
}

const URL_PATTERN = "https?://[^\\s<]+|www\\.[^\\s<]+\\.[^\\s<]+";
const EMAIL_PATTERN = "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}";
const PHONE_PATTERN = "\\+?\\d[\\d\\s().\\-]{6,}\\d";

const LINKIFY_RE = new RegExp(
  `(${URL_PATTERN}|${EMAIL_PATTERN}|${PHONE_PATTERN})`,
  "gi",
);

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^www\./i.test(s);
}

function isEmail(s: string): boolean {
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(s);
}

function isPhone(s: string): boolean {
  return s.replace(/\D/g, "").length >= 7;
}

export function linkifyContactInfo(text: string): React.ReactNode {
  if (!text) return text;

  const parts = text.split(LINKIFY_RE);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (!part) return null;

    if (isUrl(part)) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }

    if (isEmail(part)) {
      return (
        <a
          key={i}
          href={`mailto:${part}`}
          style={linkStyle}
          className="underline decoration-dotted underline-offset-2 hover:opacity-80"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }

    if (isPhone(part)) {
      const telDigits = part.replace(/[^\d+]/g, "");
      if (telDigits) {
        return (
          <a
            key={i}
            href={`tel:${telDigits}`}
            style={linkStyle}
            className="underline decoration-dotted underline-offset-2 hover:opacity-80"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
    }

    return part;
  });
}
