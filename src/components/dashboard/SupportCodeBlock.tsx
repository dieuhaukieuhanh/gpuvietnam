'use client';

import { useCallback, useState } from 'react';
import { formatSupportCode } from '@/lib/support-code';

type SupportCodeBlockProps = {
  requestId?: string | null;
  supportCode?: string | null;
  /** Compact inline vs alert block */
  variant?: 'alert' | 'inline';
};

/**
 * Customer-facing Support Code with one-click copy of the full requestId
 * (for `npm run logs:trace -- <requestId>`).
 */
export function SupportCodeBlock({
  requestId,
  supportCode,
  variant = 'alert',
}: SupportCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const code = supportCode || formatSupportCode(requestId) || null;
  const copyValue = requestId || code;

  const onCopy = useCallback(async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [copyValue]);

  if (!code) return null;

  if (variant === 'inline') {
    return (
      <span className="support-code-inline">
        Support Code: <strong>{code}</strong>{' '}
        <button type="button" className="support-code-copy" onClick={() => void onCopy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
    );
  }

  return (
    <div className="support-code-block" role="status">
      <div className="support-code-title">Something went wrong.</div>
      <div className="support-code-row">
        <span>
          Support Code: <strong className="support-code-value">{code}</strong>
        </span>
        <button type="button" className="btn btn-secondary btn-sm support-code-copy" onClick={() => void onCopy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="support-code-hint">Give this code to support so we can trace the request.</div>
    </div>
  );
}