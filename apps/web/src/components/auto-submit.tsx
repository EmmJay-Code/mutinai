'use client';

/** A select that submits its form on change. The form keeps a submit button inside <noscript> for no-JS use. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
