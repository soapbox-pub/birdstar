// Linkifies the plaintext description / summary of a Birdstar calendar
// event. Calendar events store their description as a plain string
// (NIP-52 `content`) rather than a full Nostr event, so we can't reuse
// `NoteContent` (which needs a `NostrEvent`). This is a lightweight
// linkifier in the same spirit: it turns https URLs, nostr: references,
// and #hashtags into links while leaving everything else as text.
//
// URLs are https-only (sanitized) as XSS defense-in-depth, matching the
// rest of the calendar-event UI. `whitespace-pre-wrap` preserves the
// author's line breaks.
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface LinkifiedEventTextProps {
  text: string;
  className?: string;
}

const LINK_CLASS =
  'text-emerald-700 underline-offset-2 hover:underline break-all dark:text-amber-300';

// URLs, nostr: references, and hashtags. Kept deliberately close to
// NoteContent's regex so the two linkifiers behave consistently.
const TOKEN_REGEX =
  /(https?:\/\/[^\s]+)|nostr:(npub1|note1|nprofile1|nevent1|naddr1)([023456789acdefghjklmnpqrstuvwxyz]+)|(#[\p{L}\p{N}_]+)/giu;

/** https-only URL allowlist; returns null for anything else. */
function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function LinkifiedEventText({
  text,
  className,
}: LinkifiedEventTextProps) {
  const parts = useMemo<ReactNode[]>(() => {
    const out: ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    let match: RegExpExecArray | null;

    // Reset lastIndex defensively in case the shared regex retains
    // state across renders (it's module-scoped + global).
    TOKEN_REGEX.lastIndex = 0;

    while ((match = TOKEN_REGEX.exec(text)) !== null) {
      const [full, url, nostrPrefix, nostrData, hashtag] = match;
      const index = match.index;

      if (index > lastIndex) {
        out.push(text.slice(lastIndex, index));
      }

      if (url) {
        const safe = safeHttpUrl(url);
        if (safe) {
          out.push(
            <a
              key={`u${key++}`}
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS}
            >
              {url}
            </a>,
          );
        } else {
          out.push(url);
        }
      } else if (nostrPrefix && nostrData) {
        const id = `${nostrPrefix}${nostrData}`;
        try {
          const decoded = nip19.decode(id);
          if (decoded.type === 'npub') {
            out.push(<NostrMention key={`m${key++}`} pubkey={decoded.data} />);
          } else if (decoded.type === 'nprofile') {
            out.push(
              <NostrMention key={`m${key++}`} pubkey={decoded.data.pubkey} />,
            );
          } else {
            out.push(
              <Link key={`n${key++}`} to={`/${id}`} className={LINK_CLASS}>
                {full}
              </Link>,
            );
          }
        } catch {
          out.push(full);
        }
      } else if (hashtag) {
        out.push(
          <Link
            key={`h${key++}`}
            to={`/t/${hashtag.slice(1)}`}
            className={LINK_CLASS}
          >
            {hashtag}
          </Link>,
        );
      }

      lastIndex = index + full.length;
    }

    if (lastIndex < text.length) {
      out.push(text.slice(lastIndex));
    }

    return out;
  }, [text]);

  return (
    <div className={cn('whitespace-pre-wrap wrap-break-word', className)}>
      {parts.length > 0 ? parts : text}
    </div>
  );
}

function NostrMention({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);
  const displayName = author.data?.metadata?.name ?? genUserName(pubkey);

  return (
    <Link to={`/${npub}`} className={cn(LINK_CLASS, 'font-medium')}>
      @{displayName}
    </Link>
  );
}
