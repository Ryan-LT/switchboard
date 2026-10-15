import { api, type Item } from '@/shared/api';
import { Icon, toast } from '@/shared/ui';
import { canResume, titleOf } from '../model/status';

/** Clipboard API first; the older copy command as a fallback (it works wherever a click is allowed to copy). */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

/**
 * Opens the chat in Claude Code. From a search, `copyText` (the reply you pasted) goes to the clipboard first,
 * so you can paste it straight into the chat.
 */
export function ResumeButton({ c, copyText }: { c: Item; copyText?: string }) {
  if (!canResume(c)) return null;
  const onClick = async () => {
    const copied = copyText?.trim() ? await copy(copyText.trim()) : undefined;
    api.openInClaude(c.id).then(
      (r) =>
        toast(
          copied
            ? 'Your message is copied. Paste it into the chat with ⌘V.'
            : copied === false
              ? `Opening “${titleOf(c)}”. Copying didn't work: copy your message from the search box.`
              : r.imported
              ? `Opening “${titleOf(c)}”. Claude adds it to the signed-in account first.`
              : `Opening “${titleOf(c)}” in Claude`,
        ),
      (e) => toast(e.message ?? 'Could not open Claude'),
    );
  };
  return (
    <button className="btn primary sm" onClick={onClick} title={copyText ? 'Copy your message and open this chat in Claude Code' : 'Open this chat in Claude Code'}>
      <Icon name={copyText ? 'copy' : 'play'} size={13} />
      {copyText ? 'Copy & open' : 'Resume'}
    </button>
  );
}
