import { useId } from 'react';

/**
 * The Nexus mark: two strands woven with real over/under gaps — many threads
 * becoming one fabric. Geometry is authored on a 32-unit grid and mirrored in
 * `assets/brand/nexus-mark.svg`; the viewBox is cropped to the braid's ink box
 * (27.45 x 13.25 at 2.275,9.375) so the mark can be sized by width in the UI.
 * Keep the geometry and the master in sync.
 */
const STRAND_FRONT =
  'M 4 11.1 L 4.375 11.124 L 4.75 11.194 L 5.125 11.311 L 5.5 11.473 L 5.875 11.679 L 6.25 11.926 L 6.625 12.212 L 7 12.535 L 7.375 12.891 L 7.75 13.278 L 8.125 13.69 L 8.5 14.125 L 8.875 14.578 L 9.25 15.044 L 9.625 15.52 L 10 16 L 10.375 16.48 L 10.75 16.956 L 11.125 17.422 L 11.5 17.875 L 11.875 18.31 L 12.25 18.722 L 12.625 19.109 L 13 19.465 L 13.375 19.788 L 13.75 20.074 L 14.125 20.321 L 14.5 20.527 L 14.875 20.689 L 15.25 20.806 L 15.625 20.876 L 16 20.9 L 16.375 20.876 L 16.75 20.806 L 17.125 20.689 L 17.5 20.527 L 17.875 20.321 L 18.25 20.074 L 18.625 19.788 L 19 19.465 L 19.375 19.109 L 19.75 18.722 L 20.125 18.31 L 20.5 17.875 L 20.875 17.422 L 21.25 16.956 L 21.625 16.48 L 22 16 L 22.375 15.52 L 22.75 15.044 L 23.125 14.578 L 23.5 14.125 L 23.875 13.69 L 24.25 13.278 L 24.625 12.891 L 25 12.535 L 25.375 12.212 L 25.75 11.926 L 26.125 11.679 L 26.5 11.473 L 26.875 11.311 L 27.25 11.194 L 27.625 11.124 L 28 11.1';

const STRAND_BACK =
  'M 4 20.9 L 4.375 20.876 L 4.75 20.806 L 5.125 20.689 L 5.5 20.527 L 5.875 20.321 L 6.25 20.074 L 6.625 19.788 L 7 19.465 L 7.375 19.109 L 7.75 18.722 L 8.125 18.31 L 8.5 17.875 L 8.875 17.422 L 9.25 16.956 L 9.625 16.48 L 10 16 L 10.375 15.52 L 10.75 15.044 L 11.125 14.578 L 11.5 14.125 L 11.875 13.69 L 12.25 13.278 L 12.625 12.891 L 13 12.535 L 13.375 12.212 L 13.75 11.926 L 14.125 11.679 L 14.5 11.473 L 14.875 11.311 L 15.25 11.194 L 15.625 11.124 L 16 11.1 L 16.375 11.124 L 16.75 11.194 L 17.125 11.311 L 17.5 11.473 L 17.875 11.679 L 18.25 11.926 L 18.625 12.212 L 19 12.535 L 19.375 12.891 L 19.75 13.278 L 20.125 13.69 L 20.5 14.125 L 20.875 14.578 L 21.25 15.044 L 21.625 15.52 L 22 16 L 22.375 16.48 L 22.75 16.956 L 23.125 17.422 L 23.5 17.875 L 23.875 18.31 L 24.25 18.722 L 24.625 19.109 L 25 19.465 L 25.375 19.788 L 25.75 20.074 L 26.125 20.321 L 26.5 20.527 L 26.875 20.689 L 27.25 20.806 L 27.625 20.876 L 28 20.9';

export function NexusLogo({ className }: { className?: string }) {
  // useId() can contain characters that break url(#…) references. The weave
  // alternates: the front strand is cut at the first crossing (x=10) and the
  // back strand at the second (x=22), so the two gaps are separate masks.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const frontMask = `weave-front-${id}`;
  const backMask = `weave-back-${id}`;
  return (
    <svg
      viewBox="2.275 9.375 27.45 13.25"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <mask
        id={frontMask}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="32"
        height="32"
      >
        <rect width="32" height="32" fill="#fff" />
        <circle cx="10" cy="16" r="3.275" fill="#000" />
      </mask>
      <mask
        id={backMask}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="32"
        height="32"
      >
        <rect width="32" height="32" fill="#fff" />
        <circle cx="22" cy="16" r="3.275" fill="#000" />
      </mask>
      <path
        d={STRAND_BACK}
        stroke="currentColor"
        strokeWidth={3.45}
        strokeLinecap="round"
        fill="none"
        mask={`url(#${backMask})`}
      />
      <path
        d={STRAND_FRONT}
        stroke="currentColor"
        strokeWidth={3.45}
        strokeLinecap="round"
        fill="none"
        mask={`url(#${frontMask})`}
      />
    </svg>
  );
}
