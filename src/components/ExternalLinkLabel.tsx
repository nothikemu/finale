import { ExternalIcon } from "./icons";

/**
 * Link text followed by the "opens in a new tab" arrow. The last word and the arrow are kept together,
 * so the arrow is never left alone at the start of a wrapped line. The arrow is decorative; the spoken
 * form is a visually hidden note.
 */
export function ExternalLinkLabel({ text, hiddenNote }: { text: string; hiddenNote: string }) {
  const cut = text.lastIndexOf(" ");
  const head = cut === -1 ? "" : text.slice(0, cut + 1);
  const tail = cut === -1 ? text : text.slice(cut + 1);
  return (
    <>
      {head}
      <span className="nowrap">
        {tail}
        <span className="track__external" aria-hidden="true">
          <ExternalIcon size={10} />
        </span>
      </span>
      <span className="visually-hidden"> {hiddenNote}</span>
    </>
  );
}
