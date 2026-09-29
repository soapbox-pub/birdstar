import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Loader2, Search, UserRoundCheck, X } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useFollowList } from '@/hooks/useFollowList';
import { useNip05Resolve, useVerifiedNip05 } from '@/hooks/useNip05Resolve';
import { useSearchProfiles } from '@/hooks/useSearchProfiles';
import { parseProfileIdentifier } from '@/lib/profileIdentifier';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface ProfileSearchInputProps {
  /** Called with the hex pubkey of the chosen account. */
  onSelect: (pubkey: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Account typeahead: type a name to search Nostr profiles, or paste an
 * `npub` / `nprofile` / hex key / NIP-05 address to jump straight to that
 * account. A hand-rolled ARIA combobox (arrow keys, Enter, Escape) with
 * the results in a dropdown under the input, after Ditto's
 * `ProfileSearchDropdown`.
 */
export function ProfileSearchInput({
  onSelect,
  placeholder = 'Search by name or paste an npub',
  className,
  autoFocus,
}: ProfileSearchInputProps) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);

  const identifier = useMemo(() => parseProfileIdentifier(query), [query]);
  const nip05 = useNip05Resolve(identifier?.type === 'nip05' ? identifier.address : undefined);
  const identifierPubkey =
    identifier?.type === 'pubkey'
      ? identifier.pubkey
      : identifier?.type === 'nip05'
        ? (nip05.data ?? undefined)
        : undefined;

  // A pasted npub is not a name; don't send it to the search relay.
  const { data: profiles, isFetching } = useSearchProfiles(
    identifier?.type === 'pubkey' ? '' : query,
  );
  const { data: follows } = useFollowList();

  const options = useMemo(() => {
    const pubkeys = profiles.map((p) => p.pubkey).filter((pk) => pk !== identifierPubkey);
    return identifierPubkey ? [identifierPubkey, ...pubkeys] : pubkeys;
  }, [profiles, identifierPubkey]);

  const nip05Pending = identifier?.type === 'nip05' && nip05.isFetching;
  const trimmed = query.trim();
  const showList = open && trimmed.length > 0;

  // Close when focus or a click lands outside the combobox.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (pubkey: string) => {
    onSelect(pubkey);
    setQuery('');
    setSelected(0);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        if (options.length === 0) return;
        e.preventDefault();
        setOpen(true);
        setSelected((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        if (options.length === 0) return;
        e.preventDefault();
        setSelected((i) => (i - 1 + options.length) % options.length);
        break;
      case 'Enter':
        if (showList && options[selected]) {
          e.preventDefault();
          choose(options[selected]);
        }
        break;
      case 'Escape':
        if (showList) {
          // Keep the surrounding dialog open; only close the list.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        break;
    }
  };

  const activeId = showList && options[selected] ? `${listId}-${options[selected]}` : undefined;
  const loading = isFetching || nip05Pending;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label="Search accounts"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cn(
          'h-12 w-full rounded-full border border-input bg-background pl-10 pr-10 text-base outline-none transition-[color,box-shadow]',
          'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'dark:bg-input/30',
        )}
      />
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center">
        {loading && trimmed ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />
        ) : trimmed ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="rounded-full p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Accounts"
          className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-y-auto overscroll-contain rounded-xl border bg-popover py-1 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
        >
          {nip05Pending && !identifierPubkey && (
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          )}
          {options.map((pubkey, index) => (
            <ProfileOption
              key={pubkey}
              id={`${listId}-${pubkey}`}
              pubkey={pubkey}
              subtitle={pubkey === identifierPubkey && identifier?.type === 'nip05' ? identifier.address : undefined}
              selected={index === selected}
              following={!!follows?.has(pubkey)}
              onHover={() => setSelected(index)}
              onChoose={() => choose(pubkey)}
            />
          ))}
          {options.length === 0 && !loading && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {identifier?.type === 'nip05'
                ? nip05.isError
                  ? `Couldn't look up ${identifier.address}.`
                  : `No account found for ${identifier.address}.`
                : 'No accounts found.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileOption({
  id,
  pubkey,
  subtitle,
  selected,
  following,
  onHover,
  onChoose,
}: {
  id: string;
  pubkey: string;
  subtitle?: string;
  selected: boolean;
  following: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);
  const name = metadata?.name || metadata?.display_name;
  const picture = sanitizeUrl(metadata?.picture);
  const nip05 = useVerifiedNip05(metadata?.nip05, pubkey);
  const secondary = subtitle ?? nip05 ?? `${npub.slice(0, 12)}…${npub.slice(-6)}`;

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onPointerMove={onHover}
      // Keep focus in the input so the keyboard flow isn't interrupted.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onChoose}
      className={cn(
        'flex cursor-pointer items-center gap-3 px-3 py-2.5',
        selected && 'bg-accent text-accent-foreground',
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="size-10">
          {picture && <AvatarImage src={picture} alt="" className="object-cover" />}
          <AvatarFallback>{(name ?? '?').charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        {following && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary ring-2 ring-popover"
            title="Following"
          >
            <UserRoundCheck className="size-2.5 text-primary-foreground" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {author.isLoading && !name ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          <p className="truncate text-sm font-semibold">{name ?? 'Anonymous'}</p>
        )}
        <p className={cn('truncate text-xs text-muted-foreground', !subtitle && !nip05 && 'font-mono')}>
          {secondary}
        </p>
      </div>
      {following && <span className="shrink-0 text-xs text-muted-foreground">Following</span>}
    </div>
  );
}
