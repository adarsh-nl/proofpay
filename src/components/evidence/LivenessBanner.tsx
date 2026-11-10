export function LivenessBanner({ code }: { code: string | undefined }) {
  return (
    <section
      aria-label="Liveness code"
      className="rounded-xl border bg-card px-4 py-5 sm:px-6"
    >
      {code ? (
        <p className="text-base leading-relaxed sm:text-lg">
          Write{' '}
          <strong
            data-testid="liveness-code"
            className="mx-1 inline-block rounded-md bg-muted px-2 py-0.5 font-semibold tracking-[0.3em]"
          >
            {code}
          </strong>{' '}
          on paper (or show it on a phone) and include it in at least one AFTER photo.
        </p>
      ) : (
        <p className="text-base leading-relaxed text-muted-foreground">
          The 4-digit code appears here after the customer authorizes the PayPal hold.
          Write that code on paper and include it in at least one AFTER photo.
        </p>
      )}
    </section>
  );
}
