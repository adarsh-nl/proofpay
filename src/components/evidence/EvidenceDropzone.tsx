'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { EvidencePhase } from '@/shared/contracts';

export const MAX_PHOTOS_PER_PHASE = 4;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const ACCEPT = 'image/jpeg,image/png,image/webp';

export type LocalPhoto = {
  id: string;
  name: string;
  previewUrl: string;
};

type EvidenceDropzoneProps = {
  phase: EvidencePhase;
  photos: LocalPhoto[];
  disabled?: boolean;
  onAdd: (files: File[]) => Promise<void> | void;
  onRemove: (photo: LocalPhoto) => Promise<void> | void;
};

function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

export function validatePhotoSelection(
  files: File[],
  already: number,
): { accepted: File[]; message: string | null } {
  if (files.length === 0) return { accepted: [], message: null };

  const heic = files.find(isHeic);
  if (heic) {
    return {
      accepted: [],
      message: `HEIC photos are not supported (${heic.name}). Export a JPEG, PNG, or WebP and upload that.`,
    };
  }

  const tooBig = files.find((file) => file.size > MAX_PHOTO_BYTES);
  if (tooBig) {
    return {
      accepted: [],
      message: `${tooBig.name} is larger than 8 MB. Choose a smaller JPEG, PNG, or WebP.`,
    };
  }

  const unsupported = files.find(
    (file) =>
      file.type !== 'image/jpeg' &&
      file.type !== 'image/png' &&
      file.type !== 'image/webp' &&
      !/\.(jpe?g|png|webp)$/i.test(file.name),
  );
  if (unsupported) {
    return {
      accepted: [],
      message: `${unsupported.name} is not a JPEG, PNG, or WebP photo.`,
    };
  }

  const room = MAX_PHOTOS_PER_PHASE - already;
  if (room <= 0 || files.length > room) {
    return {
      accepted: [],
      message: `You can attach at most ${MAX_PHOTOS_PER_PHASE} photos in this set.`,
    };
  }

  return { accepted: files, message: null };
}

export function EvidenceDropzone({
  phase,
  photos,
  disabled = false,
  onAdd,
  onRemove,
}: EvidenceDropzoneProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const label = phase === 'before' ? 'Before' : 'After';
  const inputId = `dropzone-${phase}`;

  async function take(files: File[]) {
    const result = validatePhotoSelection(files, photos.length);
    if (result.message) {
      setMessage(result.message);
      return;
    }
    setMessage(null);
    if (result.accepted.length > 0) await onAdd(result.accepted);
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold">
        {label} photos
        <span className="ml-2 font-normal text-muted-foreground">
          {photos.length}/{MAX_PHOTOS_PER_PHASE}
        </span>
      </legend>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void take(Array.from(event.dataTransfer.files));
        }}
        className={`flex cursor-pointer flex-col gap-1 rounded-lg border border-dashed px-4 py-6 text-sm focus-within:ring-2 focus-within:ring-ring ${
          dragOver ? 'bg-muted' : 'bg-background'
        }`}
      >
        <span className="font-medium">Drop {label.toLowerCase()} photos here, or choose files</span>
        <span className="text-muted-foreground">JPEG, PNG, or WebP. Up to 8 MB each. Camera on a phone.</span>
        <input
          id={inputId}
          data-testid={`dropzone-${phase}`}
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
          type="file"
          accept={ACCEPT}
          multiple
          capture="environment"
          disabled={disabled}
          onChange={(event) => {
            const list = event.target.files;
            void take(list ? Array.from(list) : []);
            event.target.value = '';
          }}
        />
      </label>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-col gap-2">
              {/* Local preview of a photo the worker just chose. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt={`${label} photo ${index + 1}: ${photo.name}`}
                className="aspect-[4/3] w-full rounded-md border object-cover"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onRemove(photo)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No {label.toLowerCase()} photos yet.</p>
      )}
    </fieldset>
  );
}
