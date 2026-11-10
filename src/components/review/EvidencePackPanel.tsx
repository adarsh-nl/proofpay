'use client';

import { Copy, Download, FileText, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

import { PasscodePrompt } from '@/components/review/PasscodePrompt';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiClientError } from '@/lib/api-client';
import { isEndpointMissing, isPasscodeRequired, reviewerRequestOptions } from '@/lib/reviewer';

/**
 * Evidence pack (MANUAL §8 #18): the settlement agent renders a markdown report
 * (job, criteria, verdicts, forensics, timeline, PayPal ids) that a reviewer can
 * copy or download as `.md`.
 */
export function EvidencePackPanel({ jobId }: { jobId: string }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcodeOpen, setPasscodeOpen] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const report = await api.evidencePack(jobId, reviewerRequestOptions());
      setMarkdown(report);
      toast.success('Evidence pack generated');
    } catch (cause) {
      if (isPasscodeRequired(cause)) {
        setPasscodeOpen(true);
      } else if (isEndpointMissing(cause)) {
        setError(
          'The evidence-pack endpoint is not deployed yet. The button is wired to MANUAL §8 #18 and will work as soon as the agent route merges.',
        );
      } else {
        setError(
          cause instanceof ApiClientError ? cause.message : 'Could not generate the evidence pack.',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  const downloadUrl = useMemo(() => {
    if (!markdown || typeof window === 'undefined') return null;
    return URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  }, [markdown]);

  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );

  async function copy() {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success('Evidence pack copied');
    } catch {
      toast.error('Could not copy — select the text and copy manually.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
          <CardTitle>Evidence pack</CardTitle>
        </div>
        <CardDescription>
          A markdown report for disputes and the record: criteria, AI verdicts, fraud checks, photo
          timestamps and PayPal ids.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void generate()} disabled={loading} data-testid="evidence-pack-button">
            {loading ? (
              <>
                <Loader2 aria-hidden="true" className="mr-1 size-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <FileText aria-hidden="true" className="mr-1 size-4" /> Generate evidence pack
              </>
            )}
          </Button>
          {markdown ? (
            <>
              <Button variant="outline" onClick={() => void copy()}>
                <Copy aria-hidden="true" className="mr-1 size-4" /> Copy markdown
              </Button>
              {downloadUrl ? (
                <Button asChild variant="outline">
                  <a href={downloadUrl} download={`${jobId}-evidence-pack.md`}>
                    <Download aria-hidden="true" className="mr-1 size-4" /> Download .md
                  </a>
                </Button>
              ) : null}
            </>
          ) : null}
        </div>

        {error ? (
          <p role="alert" data-testid="toast-error" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {markdown ? (
          <div
            data-testid="evidence-pack-markdown"
            className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/20 p-4 text-sm"
          >
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h3 className="mt-4 mb-2 text-lg font-semibold first:mt-0">{children}</h3>
                ),
                h2: ({ children }) => (
                  <h4 className="mt-4 mb-2 text-base font-semibold">{children}</h4>
                ),
                h3: ({ children }) => (
                  <h5 className="mt-3 mb-1 font-semibold">{children}</h5>
                ),
                p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
                table: ({ children }) => (
                  <table className="mb-3 w-full border-collapse text-xs">{children}</table>
                ),
                th: ({ children }) => (
                  <th className="border bg-muted px-2 py-1 text-left font-semibold">{children}</th>
                ),
                td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
                code: ({ children }) => (
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
                ),
                a: ({ children, href }) => (
                  <a className="underline" href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        ) : null}
      </CardContent>

      <PasscodePrompt open={passcodeOpen} onOpenChange={setPasscodeOpen} onSaved={() => void generate()} />
    </Card>
  );
}
