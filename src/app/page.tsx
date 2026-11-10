export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">ProofPay</h1>
      <p className="max-w-xl text-lg text-zinc-600">
        Vision-verified escrow on PayPal. Funds are held by PayPal until the work
        is verified from before/after photos.
      </p>
      <p className="text-sm text-zinc-500">
        Setup in progress — customer, worker and reviewer screens land next.
      </p>
    </main>
  );
}
