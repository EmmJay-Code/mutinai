'use client';

/** Unexpected runtime errors. Shows only the opaque digest, never the message or stack. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Error</div>
          <h1>Something went wrong</h1>
          <p className="lede">This page couldn’t be loaded. Please try again in a moment.</p>
        </div>
      </div>
      <p>
        <button className="btn" type="button" onClick={() => retry()}>Try again</button>
        {error.digest && <span className="small muted"> Reference <span className="mono">{error.digest}</span></span>}
      </p>
    </>
  );
}
