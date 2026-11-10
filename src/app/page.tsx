import { ArrowRight, Camera, CheckCircle2, Package, ShieldCheck, Sparkles, Users, Wallet, Wrench } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { RoleSetter } from '@/components/layout/RoleSetter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STEPS = [
  {
    icon: Wallet,
    title: 'Hold with PayPal',
    body: 'The customer authorizes the payment with PayPal Orders v2. The money is held, not charged.',
  },
  {
    icon: Camera,
    title: 'Prove with photos',
    body: 'The worker uploads before and after photos, with a 4-digit liveness code visible in an after shot.',
  },
  {
    icon: Sparkles,
    title: 'AI verifies',
    body: 'Vision AI checks every acceptance criterion, draws the evidence boxes and flags duplicates or a different scene.',
  },
  {
    icon: CheckCircle2,
    title: 'Capture',
    body: 'Pay in full, pay part and release the rest, or void the hold. A human always approves the money movement.',
  },
] as const;

const ROLES = [
  {
    role: 'customer',
    title: 'Customer',
    testId: 'role-card-customer',
    icon: Users,
    body: 'Describe the job, let AI draft the acceptance criteria, hold the money with PayPal and approve the settlement.',
    cta: 'Start as customer',
  },
  {
    role: 'worker',
    title: 'Worker',
    testId: 'role-card-worker',
    icon: Wrench,
    body: 'Read the checklist, photograph the before and after, include the liveness code and get paid for verified work.',
    cta: 'Start as worker',
  },
  {
    role: 'reviewer',
    title: 'Reviewer',
    testId: 'role-card-reviewer',
    icon: ShieldCheck,
    body: 'Review the AI verdicts and fraud flags, approve a full or partial capture, or reject and void the hold.',
    cta: 'Start as reviewer',
  },
] as const;

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4">
      <Suspense fallback={null}>
        <RoleSetter />
      </Suspense>

      <section className="py-12 sm:py-20" aria-labelledby="hero-title">
        <Badge variant="outline" className="mb-4 border-emerald-300 bg-emerald-50 text-emerald-800">
          PayPal AI Hackathon · Sandbox demo
        </Badge>
        <h1 id="hero-title" className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Money moves when the camera says the job is done.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          ProofPay is vision-verified escrow on PayPal. The payment is held while the work happens, AI
          checks the before/after photos against the acceptance criteria, and every capture needs a
          recorded human approval.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/?as=customer">
              Start as customer <ArrowRight aria-hidden="true" className="ml-1 size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/?as=reviewer">Open the reviewer console</Link>
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Held by PayPal · Verified by AI · No real money moves in this demo
        </p>
      </section>

      <section className="pb-12 sm:pb-16" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-6 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="grid size-8 place-items-center rounded-md bg-emerald-100 text-emerald-800"
                    >
                      <step.icon className="size-4" />
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">Step {index + 1}</span>
                  </div>
                  <CardTitle className="pt-2 text-base">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="pb-12 sm:pb-16" aria-labelledby="origin-story">
        <Card className="border-amber-200 bg-amber-50/60">
          <CardHeader>
            <div className="flex items-center gap-2 text-amber-900">
              <Package aria-hidden="true" className="size-5" />
              <h2 id="origin-story" className="font-heading text-lg leading-snug font-medium">
                Why we built ProofPay
              </h2>
            </div>
            <CardDescription className="text-amber-900/80">
              A parcel marked &ldquo;delivered&rdquo; that never arrived. No photo. Money already moved.
              The dispute took weeks and both sides lost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-900/90">
              ProofPay replaces &ldquo;trust me&rdquo; with evidence: PayPal holds the money, the worker
              proves the work with photos, AI checks the checklist and the fraud signals, and a person
              approves the capture. If the proof is not there, the hold is released instead of paid out.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="pb-16" aria-labelledby="pick-role">
        <h2 id="pick-role" className="text-2xl font-semibold tracking-tight">
          Pick a role to explore
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Each role sees the same job from its own side. Switching a role sets a cookie; it is a demo
          switch, not a login.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((role) => (
            <Card key={role.role} className="flex h-full flex-col transition-shadow hover:shadow-md">
              <CardHeader>
                <role.icon aria-hidden="true" className="mb-1 size-6 text-emerald-700" />
                <CardTitle className="text-lg">{role.title}</CardTitle>
                <CardDescription>{role.body}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto pt-0">
                <Button asChild variant="outline" className="w-full" data-testid={role.testId}>
                  <Link href={`/?as=${role.role}`}>{role.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
