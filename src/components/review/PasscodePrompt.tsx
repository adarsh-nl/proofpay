'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { clearStoredPasscode, getStoredPasscode, storePasscode } from '@/lib/reviewer';

export interface PasscodePromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a passcode is saved, so the caller can retry its request. */
  onSaved: () => void;
}

/**
 * One-time reviewer passcode prompt (C8). Shown when a reviewer request answers
 * 403 `REVIEWER_PASSCODE_REQUIRED`; the code is kept in sessionStorage only.
 */
export function PasscodePrompt({ open, onOpenChange, onSaved }: PasscodePromptProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasStored = getStoredPasscode() !== null;

  function save() {
    if (value.trim().length === 0) {
      setError('Enter the reviewer passcode.');
      return;
    }
    storePasscode(value.trim());
    setValue('');
    setError(null);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reviewer passcode</DialogTitle>
          <DialogDescription>
            This hosted demo gates the reviewer console. Enter the passcode once; it is kept in this
            browser tab for the session only.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span>Passcode</span>
          <Input
            type="password"
            value={value}
            data-testid="reviewer-passcode"
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                save();
              }
            }}
          />
          {error ? (
            <span role="alert" className="text-xs text-destructive">
              {error}
            </span>
          ) : null}
        </label>
        <DialogFooter>
          {hasStored ? (
            <Button
              variant="outline"
              onClick={() => {
                clearStoredPasscode();
                onOpenChange(false);
                setValue('');
              }}
            >
              Forget passcode
            </Button>
          ) : null}
          <Button onClick={save}>Unlock reviewer console</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
